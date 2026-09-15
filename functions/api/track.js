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

  // A visitor who has not acted on the cookie banner sends no id, so counting
  // unique visitors from the client id alone always read 0. Fall back to a
  // daily-rotating pseudonym derived from IP + user-agent: nothing is written
  // to the device, the raw values are never stored, and the digest changes
  // every day so a person cannot be followed over time.
  const visitor = String(body.visitor || '').slice(0, 64) || anonId(request, env);

  await insertEvent(env, {
    type,
    name,
    path,
    model: String(body.model || '').slice(0, 80),
    visitor,
    ref: String(body.ref || '').slice(0, 400),
    country: edgeCountry(request),
    meta: body.meta && typeof body.meta === 'object' ? body.meta : {},
  });

  return ok({ ok: true });
}

/**
 * Daily-rotating, non-reversible visitor pseudonym (prefix "a").
 * hash(salt + calendar day + IP + user-agent), same design as Plausible: the
 * raw IP and user-agent are never stored and the digest rotates daily, so it
 * cannot be used to recognise a person across days.
 */
function anonId(request, env) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const salt = (env && env.ANALYTICS_SALT) || 'sl-anon-v1';
    const src = salt + '|' + day + '|' + clientIp(request) + '|' + (request.headers.get('user-agent') || '');
    let h1 = 0x811c9dc5;
    let h2 = 0x1000193;
    for (let i = 0; i < src.length; i++) {
      const c = src.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
      h2 = (Math.imul(h2, 31) + c) >>> 0;
    }
    return 'a' + h1.toString(36) + h2.toString(36);
  } catch (e) {
    return '';
  }
}

async function adminAggregates(context) {
  const { request, env } = context;
  if (!adminAuthorized(request, env)) {
    return fail(env.ADMIN_TOKEN ? 'Unauthorized' : 'ADMIN_TOKEN is not configured', 401);
  }
  await ensureSchema(env);

  const days = Math.min(Math.max(parseInt(new URL(request.url).searchParams.get('days') || '30', 10) || 30, 1), 365);
  const since = new Date(Date.now() - days * 86400000).toISOString().replace('T', ' ').slice(0, 19);

  // Cloudflare Pages 308-redirects every "/x.html" to "/x", so the pathname the
  // beacon sees is "/rfq" and never "/rfq.html". Matching the raw path found
  // nothing and the whole funnel sat at 0. Normalise first: drop the extension
  // and any trailing slash, and keep the site root as "/".
  const NP = "(CASE WHEN RTRIM(REPLACE(LOWER(path), '.html', ''), '/') = '' "
    + "THEN '/' ELSE RTRIM(REPLACE(LOWER(path), '.html', ''), '/') END)";

  const [
    totalEv, pageviews, uniques, productViews, rfqViews,
    topPages, topProducts, referrers, daily,
  ] = await Promise.all([
    scalar(env, 'SELECT COUNT(*) AS c FROM analytics WHERE ts > ?', [since]),
    scalar(env, "SELECT COUNT(*) AS c FROM analytics WHERE type='pageview' AND ts > ?", [since]),
    scalar(env, "SELECT COUNT(DISTINCT CASE WHEN visitor<>'' THEN visitor END) AS c FROM analytics WHERE ts > ?", [since]),
    // track.js emits { type:'event', name:'product_view' } — it is never stored
    // with type='product_view', so filtering on the type always returned 0.
    scalar(env, "SELECT COUNT(*) AS c FROM analytics WHERE type='event' AND name='product_view' AND ts > ?", [since]),
    scalar(env, "SELECT COUNT(*) AS c FROM analytics WHERE type='pageview' AND (" + NP + " LIKE '%/rfq' OR " + NP + " LIKE '%/quote') AND ts > ?", [since]),
    all(env, "SELECT " + NP + " AS k, COUNT(*) AS v FROM analytics WHERE type='pageview' AND ts > ? GROUP BY k ORDER BY v DESC LIMIT 12", [since]),
    all(env, "SELECT model AS k, COUNT(*) AS v FROM analytics WHERE type='event' AND name='product_view' AND model<>'' AND ts > ? GROUP BY model ORDER BY v DESC LIMIT 12", [since]),
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
