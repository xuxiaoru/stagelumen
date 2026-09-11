/**
 * POST /api/inquiry  — public inquiry capture (the P0 "stop the leak" endpoint)
 *
 * Zero dependencies. Works with or without D1 / AI / notification config:
 *   - no D1  -> still triages, still notifies, returns persisted:false
 *   - no AI  -> rule engine only
 *   - nothing configured -> logs to console (visible in Pages Functions logs)
 */

import { ok, fail, handleOptions, readBody, str, isEmail, uid, nowIso, clientIp, edgeCountry } from '../_lib/util.js';
import { upsertCustomer, insertLead, logAgentRun, rateLimited, updateLead } from '../_lib/db.js';
import { ensureSchema } from '../_lib/schema.js';
import { triage, refineWithAI, templateReply } from '../_lib/reception.js';
import { notifyAll } from '../_lib/notify.js';

export async function onRequest(context) {
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
    return fail('Too many requests. Please contact sales@rigelighting.com directly.', 429);
  }

  // ---- validate ----------------------------------------------------------
  const email = str(body.email, 254).toLowerCase();
  if (!isEmail(email)) {
    return fail('A valid business email is required.', 422);
  }
  const rawText = str(body.message, 4000);
  if (!rawText && !str(body.category, 80)) {
    return fail('Please tell us what you need.', 422);
  }

  await ensureSchema(env);

  // ---- assemble ----------------------------------------------------------
  const ts = nowIso();
  const lead = {
    id: uid('ld'),
    customer_id: null,
    name: str(body.firstName, 60) + (str(body.lastName, 60) ? ' ' + str(body.lastName, 60) : '') ||
          str(body.name, 120),
    email,
    company: str(body.company, 160),
    country: str(body.country, 80) || edgeCountry(request),
    phone: str(body.phone, 60),
    sku: str(body.sku, 60),
    product_name: str(body.productName, 160),
    category: str(body.category, 80),
    application: str(body.application, 80),
    qty: str(body.qty, 40),
    budget: str(body.budget, 40),
    lead_time: str(body.leadTime, 40),
    trade_terms: str(body.tradeTerms, 40),
    raw_text: rawText,
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
  lead.lang = base.lang;
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

  // ---- notify ------------------------------------------------------------
  const notified = base.intent === 'spam' ? { email: false, webhook: false, github: false }
    : await notifyAll(env, lead, base);
  rescued = !!(notified && (notified.github || notified.email || notified.webhook));

  return ok({
    id: lead.id,
    persisted,
    rescued,
    triage: { intent: base.intent, urgency: base.urgency, score: base.score, stage: base.stage },
    model: modelUsed,
    ms: Date.now() - t0,
  });
}
