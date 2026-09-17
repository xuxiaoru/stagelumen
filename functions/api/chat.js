/**
 * POST /api/chat  ->  sales assistant reply (public, rate-limited)
 *
 * Public because visitors use it, which is exactly why it is rate limited:
 * an unthrottled endpoint wired to Workers AI is a free text generator for
 * anyone who finds it.
 *
 * Every exchange is archived (see ARCHIVE below). The visitor gets their
 * answer first; storage failures are logged and never surfaced, because a
 * buyer asking about MOQ does not care that D1 hiccuped.
 *
 * Body: { message, lang?, sku?, pageUrl?, sessionId?, history? }
 */

import { ok, fail, handleOptions, readBody, str, clientIp, edgeCountry, uid, nowIso } from '../_lib/util.js';
import {
  hitRate, logAgentRun, hasDb, scalar, run, one,
  upsertChatSession, updateChatSession, insertChatMessage, listChatMessages,
  upsertCustomer, insertLead, updateLead,
} from '../_lib/db.js';
import { ensureSchema } from '../_lib/schema.js';
import { answer } from '../_lib/sales.js';
import { triage } from '../_lib/reception.js';
import { notifyAll } from '../_lib/notify.js';

/**
 * How many exchanges before a conversation can create a lead on its own.
 *
 * Two messages is someone browsing; five is someone working through the
 * details. Below this threshold an anonymous chat stays exactly that — the
 * lead inbox is for real demand, and nothing erodes trust in it faster than
 * a dozen "hi" threads.
 */
const QUALIFY_AFTER = 4;

const SESSION_RE = /^[a-z0-9_-]{8,48}$/i;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

function sanitizeHistory(h) {
  if (!Array.isArray(h)) return [];
  return h
    .slice(-12)
    .map((m) => ({
      role: String((m && m.role) || '').toLowerCase() === 'assistant' ? 'assistant' : 'user',
      content: str(m && m.content, 800),
    }))
    .filter((m) => m.content)
    .slice(-6);
}

function firstEmail(text) {
  const m = String(text || '').match(EMAIL_RE);
  return m ? m[0].toLowerCase() : '';
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'POST') return fail('Method not allowed', 405);

  const ip = clientIp(request);

  if (hasDb(env)) {
    // hitRate, NOT rateLimited — the latter counts rows in `leads`, so it
    // always returned 0 here and throttled nothing. With Workers AI now bound,
    // an unthrottled public endpoint is a free text generator for anyone.
    const limited = await hitRate(env, 'chat:' + ip, 20, 10).catch(() => false);
    if (limited) return fail('Too many messages. Please slow down.', 429);
  }

  let body;
  try {
    body = await readBody(request);
  } catch (e) {
    return fail('Invalid JSON body', 400);
  }

  const message = str(body.message, 800);
  if (!message) return fail('message is required', 422);

  const rawSid = str(body.sessionId, 48);
  // Browser-generated ids are honoured so a page reload continues the same
  // transcript. Anything that does not match gets a fresh server-side id
  // rather than being written through — it is untrusted input.
  const sessionId = SESSION_RE.test(rawSid) ? rawSid : uid('cs');
  const history = sanitizeHistory(body.history);

  await ensureSchema(env);

  let res;
  try {
    res = await answer(env, request, {
      message,
      lang: str(body.lang, 8),
      sku: str(body.sku, 64),
      prior: history,
    });
  } catch (e) {
    console.error('[chat] ' + (e && e.message ? e.message : String(e)));
    return fail('Assistant unavailable', 503);
  }

  const payload = {
    reply: res.reply,
    sources: res.sources || [],
    model: res.model,
    degraded: !!res.degraded,
    ms: res.ms,
    sessionId,
  };

  // ---------------------------------------------------------------- ARCHIVE
  // Everything below is bookkeeping. It must not change the answer above.
  const persisted = hasDb(env);
  if (persisted) {
    try {
      await upsertChatSession(env, {
        id: sessionId,
        visitor: str(body.visitorId, 64) || sessionId,
        lang: res.lang || '',
        page_url: str(body.pageUrl, 500),
        referrer: str(request.headers.get('referer'), 500),
        country: edgeCountry(request),
        ip,
        ua: str(request.headers.get('user-agent'), 300),
      });

      await insertChatMessage(env, {
        id: uid('cm'), session_id: sessionId, role: 'visitor',
        content: message, model: '', degraded: 0, sources: '',
      });
      await insertChatMessage(env, {
        id: uid('cm'), session_id: sessionId, role: 'assistant',
        content: res.reply, model: String(res.model || 'none'),
        degraded: res.degraded ? 1 : 0, sources: res.sources || [],
      });

      const rows = await listChatMessages(env, sessionId, 200);
      await updateChatSession(env, sessionId, { msg_count: rows.length });

      const bookkeeping = qualifyConversation(env, request, sessionId, rows, ip, body).catch((e) => {
        console.error('[chat.qualify] ' + ((e && e.stack) || e));
      });

      // Don't make the buyer wait for email/webhook notifications.
      if (typeof context.waitUntil === 'function') context.waitUntil(bookkeeping);
      else await bookkeeping;
    } catch (e) {
      console.error('[chat.archive] ' + ((e && e.stack) || e));
    }
  }

  if (persisted) {
    await logAgentRun(env, {
      id: uid('run_'),
      agent: 'sales',
      model: String(res.model || 'none'),
      ok: res.degraded ? 0 : 1,
      ms: res.ms || 0,
      created_at: nowIso(),
    }).catch(() => {});
  }

  return ok(payload);
}

/**
 * Score the accumulated conversation and, once it looks like real demand,
 * turn it into a lead the human team is actually notified about.
 *
 * Why reuse triage() instead of a new classifier: it already knows our intents
 * and scoring, and every downstream surface (lead inbox, notification email,
 * GitHub issue) is built around them.
 */
async function qualifyConversation(env, request, sessionId, rows, ip, body) {
  const visitorText = rows
    .filter((m) => m.role === 'visitor')
    .map((m) => m.content)
    .join('\n')
    .slice(0, 3000);

  const email = firstEmail(visitorText);
  const base = triage({
    raw_text: visitorText,
    email,
    category: '',
    application: '',
    product_name: str(body.sku, 64),
    sku: str(body.sku, 64),
    qty: '',
    budget: '',
    lead_time: '',
  });

  const patch = {
    intent: base.intent,
    urgency: base.urgency,
    score: base.score,
    stage: base.stage,
    lang: base.lang,
    email,
    model_hit: str(body.sku, 64),
  };
  await updateChatSession(env, sessionId, patch);

  if (base.intent === 'spam' || base.intent === 'general') return;
  if (rows.length < QUALIFY_AFTER * 2) return;

  // One lead per conversation, however long the visitor keeps typing. Two
  // messages can be processed at the same time, so ownership is claimed with
  // a conditional UPDATE first: whoever wins the claim writes the lead.
  const claimId = uid('ld');
  await run(
    env,
    "UPDATE chat_sessions SET lead_id = ? WHERE id = ? AND (lead_id IS NULL OR lead_id = '')",
    [claimId, sessionId]
  );
  const owner = await one(env, 'SELECT lead_id FROM chat_sessions WHERE id = ?', [sessionId]);
  if (!owner || owner.lead_id !== claimId) {
    // Already handed off. If the visitor only now volunteered an email, put it
    // on the existing lead — otherwise the notification our team received
    // points at a record they cannot reply to.
    if (email && owner && owner.lead_id) {
      const cur = await one(env, 'SELECT email FROM leads WHERE id = ?', [owner.lead_id]);
      if (cur && !String(cur.email || '')) {
        await run(env, 'UPDATE leads SET email = ? WHERE id = ?', [email, owner.lead_id]);
        await upsertCustomer(env, {
          id: uid('cu'), email, name: '', company: '',
          country: edgeCountry(request), phone: '', source: 'chat',
          created_at: nowIso(), updated_at: nowIso(),
        });
      }
    }
    return;
  }

  // Note: the session is deliberately NOT flipped to 'claimed' when the lead
  // is created. The assistant raising a ticket is not the same as a human
  // having answered, and the board must still show the thread as waiting.

  const ts = nowIso();
  const lead = {
    id: claimId,
    customer_id: null,
    name: '',
    email,
    company: '',
    country: edgeCountry(request),
    phone: '',
    sku: str(body.sku, 60),
    product_name: '',
    product_category: '',
    product_image: '',
    items: '',
    category: '',
    application: '',
    qty: '',
    budget: '',
    lead_time: '',
    trade_terms: '',
    raw_text:
      '[Captured from AI chat ' + sessionId + ']\n\n' +
      rows.map((m) => (m.role === 'visitor' ? 'Buyer' : 'Assistant') + ': ' + m.content).join('\n'),
    lang: base.lang,
    intent: base.intent,
    urgency: base.urgency,
    score: base.score,
    stage: base.stage,
    ai_summary:
      'Unanswered AI chat — no human has replied yet. Review the full thread at /admin/ai-chat.html (session ' +
      sessionId + ').',
    ai_reply: '',
    status: 'new',
    page_url: str(body.pageUrl, 500),
    referrer: str(request.headers.get('referer'), 500),
    utm: '',
    ip,
    ua: str(request.headers.get('user-agent'), 300),
    created_at: ts,
    updated_at: ts,
  };

  if (email) {
    lead.customer_id = await upsertCustomer(env, {
      id: uid('cu'), email, name: '', company: '', country: lead.country, phone: '',
      source: 'chat', created_at: ts, updated_at: ts,
    });
  }

  const written = await insertLead(env, lead);
  if (!written) return;

  const notified = await notifyAll(env, lead, base);
  const mask = (notified && notified.email ? 1 : 0) | (notified && notified.webhook ? 2 : 0) |
    (notified && notified.github ? 4 : 0);
  await updateLead(env, lead.id, { notified: mask, autoreply_sent: 0 });
}
