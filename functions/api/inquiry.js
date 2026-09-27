/**
 * POST /api/inquiry  — public inquiry capture (the P0 "stop the leak" endpoint)
 *
 * Zero dependencies. Works with or without D1 / AI / notification config:
 *   - no D1  -> still triages, still notifies, returns persisted:false
 *   - no AI  -> rule engine only
 *   - nothing configured -> logs to console (visible in Pages Functions logs)
 */

import { ok, fail, handleOptions, readBody, str, isEmail, uid, nowIso, clientIp, edgeCountry } from '../_lib/util.js';
import { upsertCustomer, insertLead, logAgentRun, rateLimited, updateLead, scalar } from '../_lib/db.js';
import { ensureSchema } from '../_lib/schema.js';
import { triage, refineWithAI, templateReply } from '../_lib/reception.js';
import { notifyAll, sendAutoReplyVerbose } from '../_lib/notify.js';

/**
 * Privacy-policy revision the RFQ consent box refers to.
 *
 * A timestamp alone proves nothing: it only means something next to the wording
 * the visitor actually saw. Bump this whenever privacy.html changes in a way
 * that matters, so old records keep pointing at the text they agreed to.
 */
const CONSENT_VERSION = '2026-09-27';

export async function onRequest(context) {
  // Nothing below may escape as an unhandled exception: the lead is usually
  // already persisted by then, so a throw would mean "saved but visitor sees
  // an error page". Log the stack, answer with JSON, keep the pipeline up.
  try {
    return await handleInquiry(context);
  } catch (e) {
    console.error('[inquiry] unhandled: ' + ((e && e.stack) || e));
    return fail('Inquiry processing failed: ' + String((e && e.message) || e).slice(0, 160), 500);
  }
}

/** Mirror of the RFQ form's quantity bands, used when only a basket is given. */
function qtyBand(n) {
  if (n <= 10) return '1 - 10 units';
  if (n <= 50) return '10 - 50 units';
  if (n <= 200) return '50 - 200 units';
  if (n <= 1000) return '200 - 1000 units';
  return '1000+ units';
}

async function handleInquiry(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'POST') return fail('Method not allowed', 405);
  const t0 = Date.now();

  const body = await readBody(request);

  // Honeypot: real users never fill this.
  if (str(body.hp, 100)) {
    return ok({ id: null, ignored: true });
  }

  const ip = clientIp(request);

  // Throttle (only when D1 is available to count against)
  if (await rateLimited(env, ip, 8, 10)) {
    return fail('Too many requests. Please contact sales20@rigelighting.com directly.', 429);
  }

  // ---- quote basket -----------------------------------------------------
  // items arrives as a JSON string produced by the RFQ quote list. It is the
  // authoritative version of "what did they ask for"; the flat sku / product
  // columns are still filled from the first line so older reports, the modal
  // notification emails and any external consumer keep working unchanged.
  //
  // Parsed before validation on purpose: a visitor who only built a quote list
  // and left the free-text box alone is a perfectly good lead, and the old
  // order rejected exactly those ("Please tell us what you need").
  let items = [];
  try {
    const parsed = JSON.parse(str(body.items, 8000) || '[]');
    if (Array.isArray(parsed)) {
      items = parsed.slice(0, 30).map((it) => ({
        model: str(it.model, 60),
        name: str(it.name, 160),
        qty: Math.min(Math.max(parseInt(it.qty, 10) || 1, 1), 99999),
        image: str(it.image, 400),
        category: str(it.category, 60),
        price: Number.isFinite(Number(it.price)) ? Number(it.price) : null,
      })).filter((it) => it.model);
    }
  } catch (e) {
    items = []; // a malformed basket must never lose the enquiry itself
  }

  // ---- attachments -------------------------------------------------------
  // Files go to R2 one at a time via POST /api/upload; only their descriptors
  // travel with the enquiry. Nothing here is trusted — the key must be one we
  // minted under uploads/, and the size is re-clamped — so a forged payload
  // cannot turn the lead row into a pointer to somebody else's object.
  let attachments = [];
  try {
    const parsed = JSON.parse(str(body.attachments, 4000) || '[]');
    if (Array.isArray(parsed)) {
      attachments = parsed.slice(0, 5).map((f) => ({
        key: str(f.key, 300),
        name: str(f.name, 160),
        size: Math.min(Math.max(parseInt(f.size, 10) || 0, 0), 20 * 1024 * 1024),
        type: str(f.type, 80),
      })).filter((f) => f.key.indexOf('uploads/') === 0);
    }
  } catch (e) {
    attachments = [];
  }

  // ---- validate ----------------------------------------------------------
  // Deliberately minimal. The RFQ form used to demand nine answers before it
  // would submit; a reachable address plus *some* signal of what they want is
  // the whole requirement now. Everything else is a helpful hint, not a gate.
  const email = str(body.email, 254).toLowerCase();
  if (!isEmail(email)) {
    return fail('A valid business email is required.', 422);
  }
  const rawText = str(body.message, 4000);
  if (!rawText && !str(body.category, 80) && !items.length) {
    return fail('Please tell us what you need.', 422);
  }

  await ensureSchema(env);

  const primary = items[0] || null;
  const totalQty = items.reduce((a, b) => a + (b.qty || 0), 0);

  // ---- assemble ----------------------------------------------------------
  const ts = nowIso();
  // Anything but an explicit yes is a no. Recorded with the timestamp below,
  // so the consent trail is provable rather than merely asserted.
  const consented = ['1', 'on', 'true', 'yes']
    .indexOf(str(body.consent, 8).toLowerCase()) !== -1;
  const lead = {
    id: uid('ld'),
    customer_id: null,
    name: str(body.firstName, 60) + (str(body.lastName, 60) ? ' ' + str(body.lastName, 60) : '') ||
          str(body.name, 120),
    email,
    company: str(body.company, 160),
    country: str(body.country, 80) || edgeCountry(request),
    phone: str(body.phone, 60),
    sku: str(body.sku, 60) || (primary ? primary.model : ''),
    product_name: str(body.productName, 160) || (primary ? primary.name : ''),
    product_category: str(body.productCategory, 80) || (primary ? primary.category : ''),
    product_image: str(body.productImage, 500) || (primary ? primary.image : ''),
    items: JSON.stringify(items),
    category: str(body.category, 80),
    application: str(body.application, 80),
    qty: str(body.qty, 40) || (totalQty ? qtyBand(totalQty) : ''),
    budget: str(body.budget, 40),
    lead_time: str(body.leadTime, 40),
    trade_terms: str(body.tradeTerms, 40),
    raw_text: rawText,
    attachments: JSON.stringify(attachments),
    consent_at: consented ? ts : '',
    consent_ver: consented ? CONSENT_VERSION : '',
    lang: str(body.lang, 8) || 'en',
    page_url: str(body.pageUrl, 500),
    referrer: str(request.headers.get('referer'), 500),
    utm: str(body.utm, 500),
    ip,
    ua: str(request.headers.get('user-agent'), 300),
    created_at: ts,
    updated_at: ts,
  };

  // ---- stage 1: deterministic triage ------------------------------------
  const base = triage(lead);

  // ---- stage 2: AI refinement (optional) --------------------------------
  let aiSummary = '';
  let aiReply = '';
  let modelUsed = 'rules';
  if (base.intent !== 'spam') {
    const t1 = Date.now();
    const { run: aiRun, refined } = await refineWithAI(env, lead, base);
    if (refined) {
      base.intent = refined.intent || base.intent;
      base.urgency = refined.urgency || base.urgency;
      base.score = Number.isFinite(refined.score) ? refined.score : base.score;
      aiSummary = refined.summary || '';
      aiReply = refined.reply || '';
      modelUsed = aiRun.model;
    } else {
      aiReply = templateReply(lead, base);
    }
    if (aiRun.model && aiRun.ms) {
      await logAgentRun(env, {
        id: uid('ar'), agent: 'reception', model: aiRun.model, lead_id: lead.id,
        ms: Date.now() - t1, ok: !!refined, error: aiRun.error || '',
      });
    }
  }

  // Re-derive stage after AI scoring
  if (base.intent === 'spam') base.stage = 'spam';
  else if (base.score >= 70) base.stage = 'hot';
  else if (base.score >= 45) base.stage = 'warm';
  else base.stage = 'nurture';

  lead.intent = base.intent;
  lead.urgency = base.urgency;
  lead.score = base.score;
  lead.stage = base.stage;
  // The language the visitor actually read the page in is a stronger signal
  // than a guess made from their free text — which is empty whenever they only
  // built a quote list, and then "detect" always answers 'en'. base.lang still
  // drives the auto-reply wording, which is a separate decision.
  lead.lang = str(body.lang, 8) || base.lang || 'en';
  lead.ai_summary = aiSummary;
  lead.ai_reply = aiReply;
  lead.status = base.intent === 'spam' ? 'spam' : 'new';

  // ---- persist -----------------------------------------------------------
  const customerId = await upsertCustomer(env, {
    id: uid('cu'), email, name: lead.name, company: lead.company,
    country: lead.country, phone: lead.phone, source: 'website',
    created_at: ts, updated_at: ts,
  });
  lead.customer_id = customerId;

  const persisted = await insertLead(env, lead);

  // Safety net: if the DB write failed, make sure the lead is not lost.
  let rescued = false;
  if (!persisted) {
    console.log('[inquiry] DB unavailable, payload=' + JSON.stringify(lead));
  }

  // ---- notify our own team ------------------------------------------------
  const notified = base.intent === 'spam' ? { email: false, webhook: false, github: false }
    : await notifyAll(env, lead, base);
  rescued = !!(notified && (notified.github || notified.email || notified.webhook));

  // ---- acknowledge to the customer ---------------------------------------
  // Spam never gets a reply: an auto-responder that answers bots is how a
  // domain ends up on a blocklist. Neither does anyone who trips the
  // per-address guard, which exists because this form can mail any address a
  // visitor decides to type in.
  let autoreply = { ok: false, reason: 'skipped' };
  let autoreplyFlag = 0;

  if (base.intent !== 'spam' && persisted) {
    const recent = await scalar(
      env,
      "SELECT COUNT(*) AS c FROM leads WHERE email = ? AND created_at > datetime('now', '-60 minutes')",
      [email],
      0
    ).catch(() => 0);

    if (recent > 1) {
      autoreply = { ok: false, reason: 'rate limited for this address' };
      autoreplyFlag = 3;
    } else {
      autoreply = await sendAutoReplyVerbose(env, lead);
      autoreplyFlag = autoreply.ok ? 1 : 2;
    }
  }

  // Persist what actually got delivered. Without this the admin board shows
  // zeroes for every lead and a silently broken channel stays invisible.
  const mask = (notified.email ? 1 : 0) | (notified.webhook ? 2 : 0) | (notified.github ? 4 : 0);
  if (persisted) {
    try {
      await updateLead(env, lead.id, { notified: mask, autoreply_sent: autoreplyFlag });
    } catch (e) {
      console.error('[inquiry] status update failed: ' + ((e && e.message) || e));
    }
  }

  return ok({
    id: lead.id,
    persisted,
    rescued,
    notified,
    // Deliberately coarse: this endpoint is public, so internal reasons
    // (missing key, a Resend 403) stay in the server log, not the response.
    autoreply: { sent: !!autoreply.ok },
    triage: { intent: base.intent, urgency: base.urgency, score: base.score, stage: base.stage },
    model: modelUsed,
    ms: Date.now() - t0,
  });
}
