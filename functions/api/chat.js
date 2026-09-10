/**
 * POST /api/chat  ->  sales assistant reply (public, rate-limited)
 *
 * Public because visitors use it, which is exactly why it is rate limited:
 * an unthrottled endpoint wired to Workers AI is a free text generator for
 * anyone who finds it.
 *
 * Body: { message, lang?, sku?, pageUrl? }
 */

import { ok, fail, handleOptions, readBody, str, clientIp, uid, nowIso } from '../_lib/util.js';
import { hitRate, logAgentRun, hasDb } from '../_lib/db.js';
import { answer } from '../_lib/sales.js';

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

  let res;
  try {
    res = await answer(env, request, {
      message,
      lang: str(body.lang, 8),
      sku: str(body.sku, 64),
    });
  } catch (e) {
    console.error('[chat] ' + (e && e.message ? e.message : String(e)));
    return fail('Assistant unavailable', 503);
  }

  const runId = uid('run_');
  if (hasDb(env)) {
    await logAgentRun(env, {
      id: runId,
      agent: 'sales',
      model: String(res.model || 'none'),
      ok: res.degraded ? 0 : 1,
      ms: res.ms || 0,
      created_at: nowIso(),
    }).catch(() => {});
  }

  return ok({
    reply: res.reply,
    sources: res.sources || [],
    model: res.model,
    degraded: !!res.degraded,
    ms: res.ms,
  });
}
