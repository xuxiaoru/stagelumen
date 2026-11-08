/**
 * POST /api/social — publish the day's best blog article to the Facebook Page.
 * GET  /api/social — live self-check (config + token validity + page identity).
 *
 * Both are admin-only (same ADMIN_TOKEN that protects /api/indexnow and the
 * nightly content agent), so a public repo cannot turn this into an open
 * posting relay.
 *
 * Body:
 *   { "urls": ["https://www.rigebalighting.com/content/blog/<slug>", ...] }
 *   { "latest": true }                 post the newest article
 *   { "limit": 1 }                    max posts per call (1..3, default 1)
 *   { "dryRun": true }                compose copy + verify token, do not post
 *   { "unpublished": true }           create admin-only draft posts for review
 *   { "message": "..." }              override the generated copy
 *   { "force": true }                 ignore the already-posted guard
 *
 * Design decisions:
 *  - Default limit 1 on purpose. Three bare link posts per day on a young page
 *    get almost no engagement and depress the reach of everything else.
 *  - Only /content/blog/ URLs on our own canonical host are accepted, and the
 *    article must actually return 200 with an og:title before we post it.
 *  - Copy comes from the live page, not a stale local index.
 */
import { ok, json, fail, handleOptions, adminAuthorized, readBody, clamp } from '../_lib/util.js';
import {
  facebookConfig, pageSelfCheck, publishLink, normalizeArticleUrl,
  readArticle, latestArticleUrl, recentPostLinks,
} from '../_lib/facebook.js';

function composeMessage(article, override) {
  if (override) return String(override).trim().slice(0, 800);
  // og:description on our articles is an SEO fact line ("New 295W 10R beam
  // moving head costs $332"). Copying it verbatim onto a public Facebook page
  // is awkward AND publishes EXW unit prices to competitors. Default social
  // copy is therefore the title plus a fixed call to action; pass "message"
  // in the request body when a hand-written line is wanted.
  return (article.title + '\n\n' +
    'Read the full guide — fixture specs, DMX channel maps and EXW pricing.')
    .trim().slice(0, 800);
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return handleOptions();
  if (!adminAuthorized(request, env)) {
    return fail(env.ADMIN_TOKEN ? 'Unauthorized' : 'ADMIN_TOKEN is not configured', 401);
  }

  const cfg = facebookConfig(env);
  const page = await pageSelfCheck(cfg);

  if (request.method === 'GET') {
    return ok({
      configured: cfg.ok,
      missing: cfg.missing,
      page,
      ready: !!(cfg.ok && page.ok),
      hint: cfg.ok ? null : 'Set FB_PAGE_ID + FB_PAGE_TOKEN in Cloudflare Pages, then push a new commit (Retry deployment alone does not refresh env bindings).',
    });
  }
  if (request.method !== 'POST') return fail('Method not allowed', 405);
  if (!cfg.ok) {
    return json({ ok: false, error: 'Facebook is not configured', missing: cfg.missing }, 503);
  }

  const body = await readBody(request);

  // Resolve which articles are candidates.
  let urls = [];
  if (body.latest) {
    const latest = await latestArticleUrl();
    if (!latest.ok) return json({ ok: false, error: 'cannot resolve latest article: ' + latest.error }, 502);
    urls = [latest.url];
  } else {
    const raw = Array.isArray(body.urls)
      ? body.urls
      : String(body.urls || body.url || '').split(/[\s,]+/);
    urls = raw.map(normalizeArticleUrl).filter(Boolean);
  }
  urls = Array.from(new Set(urls));
  if (!urls.length) {
    return fail('nothing to post: pass {"urls":[...]} or {"latest":true} — only https://www.rigebalighting.com/content/blog/* is accepted', 422);
  }

  const limit = clamp(parseInt(body.limit, 10) || 1, 1, 3);
  const picked = urls.slice(0, limit);
  const dryRun = !!body.dryRun;
  const unpublished = !!body.unpublished;
  const override = body.message ? String(body.message) : '';
  const recent = (dryRun || body.force) ? [] : await recentPostLinks(cfg);

  const results = [];
  let posted = 0;
  let failed = 0;

  for (const url of picked) {
    const article = await readArticle(url);
    if (!article.ok) {
      failed++;
      results.push({ url, ok: false, error: article.error });
      continue;
    }
    const message = composeMessage(article, override);
    const entry = {
      url,
      title: article.title,
      message,
      image: article.image || null,
    };
    if (recent.includes(url)) {
      results.push(Object.assign(entry, { ok: true, skipped: 'already_posted' }));
      continue;
    }
    if (dryRun) {
      results.push(Object.assign(entry, { ok: true, dryRun: true }));
      continue;
    }
    const r = await publishLink(cfg, { message, link: url, published: !unpublished });
    if (r.ok) {
      posted++;
      results.push(Object.assign(entry, {
        ok: true,
        postId: r.id,
        permalink_url: r.permalink_url,
        published: r.published,
      }));
    } else {
      failed++;
      results.push(Object.assign(entry, { ok: false, error: r.error }));
    }
  }

  // A failed Graph API self-check used to be invisible in POST responses:
  // dry-run still returned ok:true with tokenValid:false. Surface the raw
  // Graph API error (never the token) and make a dry-run fail loudly.
  const graphError = page.ok ? null : (page.error || {
    message: 'Facebook page self-check failed',
    configured: page.configured !== false,
    missing: page.missing || null,
  });
  const healthy = !!(cfg.ok && page.ok);
  return json({
    ok: failed === 0 && (dryRun ? healthy : true),
    mode: dryRun ? 'dry-run' : (unpublished ? 'unpublished-draft' : 'publish'),
    page: { id: cfg.pageId, name: page.name || null, link: page.link || null },
    tokenValid: !!page.ok,
    graphError,
    selected: picked,
    candidates: urls.length,
    posted,
    failed,
    results,
  }, (failed || (dryRun && !healthy)) ? 502 : 200);
}
