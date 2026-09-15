/**
 * POST /api/track  — public, cookieless traffic + event capture
 * GET  /api/track?token=<ADMIN_TOKEN> — admin traffic aggregates
 *
 * Zero dependencies. Degrades gracefully: if D1 is not bound, POST returns
 * ok (no write) and GET returns empty aggregates — the public site never
 * breaks because analytics isn't wired up.
 *
 * Privacy: first-party only. We store a random visitor id (no PII), never the
 * raw IP, and never set cross-site cookies. Pageview/event tracking is gated
 * on the site's cookie-consent banner client-side.
 */

import { ok, fail, handleOptions, adminAuthorized, uid, nowIso, clientIp, edgeCountry } from '../_lib/util.js';
import { all, scalar, hitRate, insertEvent } from '../_lib/db.js';
import { ensureSchema } from '../_lib/schema.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method === 'GET') return adminAggregates(context);
  if (request.method !== 'POST') return fail('Method not allowed', 405);

  try {
    return await handleTrack(context);
  } catch (e) {
    console.error('[track] ' + ((e && e.stack) || e));
    return ok({ ok: true, dropped: true }); // never punish the visitor for a logging error
  }
}

async function handleTrack(context) {
  const { request, env } = context;
  const ip = clientIp(request);

  // Cheap abuse guard: 120 events/min/IP. Over the limit → silently drop.
  if (await hitRate(env, 'track:' + ip, 120, 1)) {
    return ok({ ok: true, limited: true });
  }

  let body = {};
  try {
    body = await request.json();
  } catch (e) {
    body = {};
  }
  if (!body || typeof body !== 'object') return ok({ ok: true, dropped: true });

  const type = String(body.type || 'event');
  if (type !== 'pageview' && type !== 'event') return ok({ ok: true, dropped: true });

  const name = String(body.name || '').slice(0, 60);
  const path = String(body.path || '').slice(0, 200);
  // A pageview with no path, or an event with no name, carries nothing useful.
  if (type === 'pageview' && !path) return ok({ ok: true, dropped: true });
  if (type === 'event' && !name) return ok({ ok: true, dropped: true });

  await ensureSchema(env);

  await insertEvent(env, {
    type,
    name,
    path,
    model: String(body.model || '').slice(0, 80),
    visitor: String(body.visitor || '').slice(0, 64),
    ref: String(body.ref || '').slice(0, 400),
    country: edgeCountry(request),
    meta: body.meta && typeof body.meta === 'object' ? body.meta : {},
  });

  return ok({ ok: true });
}

async function adminAggregates(context) {
  const { request, env } = context;
  if (!adminAuthorized(request, env)) {
    return fail(env.ADMIN_TOKEN ? 'Unauthorized' : 'ADMIN_TOKEN is not configured', 401);
  }
  await ensureSchema(env);

  const days = Math.min(Math.max(parseInt(new URL(request.url).searchParams.get('days') || '30', 10) || 30, 1), 365);
  const since = new Date(Date.now() - days * 86400000).toISOString().replace('T', ' ').slice(0, 19);

  const [
    totalEv, pageviews, uniques, productViews, rfqViews,
    topPages, topProducts, referrers, daily,
  ] = await Promise.all([
    scalar(env, 'SELECT COUNT(*) AS c FROM analytics WHERE ts > ?', [since]),
    scalar(env, "SELECT COUNT(*) AS c FROM analytics WHERE type='pageview' AND ts > ?", [since]),
    scalar(env, "SELECT COUNT(DISTINCT CASE WHEN visitor<>'' THEN visitor END) AS c FROM analytics WHERE ts > ?", [since]),
    scalar(env, "SELECT COUNT(*) AS c FROM analytics WHERE type='product_view' AND ts > ?", [since]),
    scalar(env, "SELECT COUNT(*) AS c FROM analytics WHERE type='pageview' AND path LIKE '%rfq.html%' AND ts > ?", [since]),
    all(env, "SELECT path AS k, COUNT(*) AS v FROM analytics WHERE type='pageview' AND ts > ? GROUP BY path ORDER BY v DESC LIMIT 12", [since]),
    all(env, "SELECT model AS k, COUNT(*) AS v FROM analytics WHERE type='product_view' AND model<>'' AND ts > ? GROUP BY model ORDER BY v DESC LIMIT 12", [since]),
    all(env, "SELECT ref AS k, COUNT(*) AS v FROM analytics WHERE ref<>'' AND ts > ? GROUP BY ref ORDER BY v DESC LIMIT 10", [since]),
    all(env, "SELECT substr(ts,1,10) AS d, COUNT(*) AS v FROM analytics WHERE ts > ? GROUP BY d ORDER BY d", [since]),
  ]);

  const inquiries = await scalar(env, 'SELECT COUNT(*) AS c FROM leads WHERE created_at > ?', [since]);
  const leadSkus = await all(env, "SELECT DISTINCT sku AS k FROM leads WHERE sku<>'' AND created_at > ?", [since]);

  // Actionable: most-viewed products that have NOT yet produced an inquiry.
  const leadSkuSet = new Set((leadSkus || []).map((r) => String(r.k || '').toLowerCase()));
  const hotNoLead = (topProducts || [])
    .filter((r) => !leadSkuSet.has(String(r.k || '').toLowerCase()))
    .slice(0, 8)
    .map((r) => ({ model: r.k, views: r.v }));

  return ok({
    days,
    total_events: totalEv,
    pageviews,
    unique_visitors: uniques,
    product_views: productViews,
    rfq_views: rfqViews,
    inquiries,
    top_pages: topPages || [],
    top_products: topProducts || [],
    referrers: referrers || [],
    daily: daily || [],
    hot_no_lead: hotNoLead,
  });
}
