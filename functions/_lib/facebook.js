/**
 * Facebook Page publishing — Graph API v26.0, zero dependencies.
 *
 * Why a Page token and never a user password: Graph API has no password auth.
 * A Page Access Token is a single, revocable string scoped to publishing on
 * ONE page, which is exactly what the nightly blog pipeline needs.
 *
 * Token lives only in Cloudflare Pages environment variables:
 *   FB_PAGE_ID     = 103654045148031   (the /me/accounts id, NOT the /p/ URL id)
 *   FB_PAGE_TOKEN  = EAAU...           (page token, expires_at = 0)
 *
 * Both are read at request time. Nothing here ever logs or returns the token.
 */
export const FB_API = 'https://graph.facebook.com/v26.0';
export const SITE = 'https://www.rigebalighting.com';
export const BLOG_PREFIX = SITE + '/content/blog/';

/** Report configuration state without ever exposing the token value. */
export function facebookConfig(env) {
  const bag = env || {};
  const pageId = String(bag.FB_PAGE_ID || '').trim();
  const token = String(bag.FB_PAGE_TOKEN || '').trim();
  const missing = [];
  if (!pageId) missing.push('FB_PAGE_ID');
  if (!token) missing.push('FB_PAGE_TOKEN');
  return {
    ok: missing.length === 0,
    pageId,
    token,
    tokenLength: token.length,
    missing,
  };
}

/**
 * One Graph API call. Token always travels in a POST body or an Authorization
 * header, never in a URL that could end up in a log line.
 */
async function graph(path, cfg, params, method) {
  const verb = method || 'GET';
  const url = FB_API + path;
  const init = {
    method: verb,
    headers: {
      'authorization': 'Bearer ' + cfg.token,
      'user-agent': 'RiGeBa-Content-Sync/1.0',
    },
  };
  if (verb === 'POST') {
    const form = new URLSearchParams();
    for (const k of Object.keys(params || {})) {
      if (params[k] !== undefined && params[k] !== null) form.set(k, String(params[k]));
    }
    init.headers['content-type'] = 'application/x-www-form-urlencoded; charset=utf-8';
    init.body = form.toString();
  } else if (params && Object.keys(params).length) {
    // GET: token is already in the Authorization header; only send fields.
    const q = new URLSearchParams();
    for (const k of Object.keys(params)) q.set(k, String(params[k]));
    return rawGraph(url + '?' + q.toString(), init);
  }
  return rawGraph(url, init);
}

async function rawGraph(url, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    return { ok: false, error: { message: 'fetch failed: ' + ((e && e.message) || String(e)) } };
  }
  let body;
  try {
    body = await res.json();
  } catch (e) {
    return { ok: false, status: res.status, error: { message: 'non-JSON response (HTTP ' + res.status + ')' } };
  }
  if (body && body.error) {
    const e = body.error;
    return {
      ok: false,
      status: res.status,
      error: {
        code: e.code,
        subcode: e.error_subcode,
        type: e.type,
        message: e.message,
        fbtrace_id: e.fbtrace_id,
      },
    };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: { message: 'HTTP ' + res.status } };
  }
  return { ok: true, status: res.status, data: body };
}

/**
 * Live self-check: proves the token is valid AND that it belongs to the page
 * we think it does. `tasks` coming back with CREATE_CONTENT is the difference
 * between a token that looks right and one that can actually post.
 */
export async function pageSelfCheck(cfg) {
  if (!cfg.ok) return { ok: false, configured: false, missing: cfg.missing };
  const r = await graph('/' + cfg.pageId, cfg, {
    fields: 'id,name,link,followers_count',
  }, 'GET');
  if (!r.ok) return { ok: false, configured: true, pageId: cfg.pageId, error: r.error };
  return {
    ok: true,
    configured: true,
    pageId: cfg.pageId,
    name: r.data.name || null,
    link: r.data.link || null,
    followers: r.data.followers_count ?? null,
    tokenLength: cfg.tokenLength,
  };
}

/**
 * Publish a link post. `message` is the native text; `link` lets Facebook
 * render the article's og:image / og:title as a preview card.
 *
 * `published:false` creates an UNPUBLISHED post visible only to page admins —
 * used for the review-before-publish mode.
 */
export async function publishLink(cfg, opts) {
  if (!cfg.ok) return { ok: false, error: { message: 'Facebook is not configured', missing: cfg.missing } };
  const o = opts || {};
  const params = {
    message: String(o.message || '').trim(),
    link: String(o.link || '').trim(),
    published: o.published === false ? 'false' : 'true',
    fields: 'id,permalink_url',
  };
  if (!params.message) return { ok: false, error: { message: 'empty message' } };
  if (!params.link.startsWith('https://')) return { ok: false, error: { message: 'link must be https' } };

  const r = await graph('/' + cfg.pageId + '/feed', cfg, params, 'POST');
  if (!r.ok) return r;
  const id = String((r.data && r.data.id) || '');
  return {
    ok: !!id,
    status: r.status,
    id,
    permalink_url: (r.data && r.data.permalink_url) || (id ? 'https://www.facebook.com/' + id : null),
    published: params.published === 'true',
    error: id ? null : { message: 'Graph API returned no post id' },
  };
}

/**
 * Links already posted recently. Re-running the workflow (or a retry after a
 * timeout) must not put the same article on the page twice. A permission
 * failure here degrades to an empty list — never block publishing because of
 * a read-only call.
 */
export async function recentPostLinks(cfg) {
  if (!cfg.ok) return [];
  const r = await graph('/' + cfg.pageId + '/posts', cfg, {
    fields: 'link,created_time',
    limit: '25',
  }, 'GET');
  if (!r.ok) return [];
  const rows = (r.data && Array.isArray(r.data.data)) ? r.data.data : [];
  return rows.map((p) => normalizeArticleUrl(p.link || '')).filter(Boolean);
}

/**
 * Normalise an article URL into its canonical form and reject anything that is
 * not one of our own blog posts. A hostile caller with the admin token should
 * still not be able to make the page advertise an arbitrary site.
 */
export function normalizeArticleUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (s.startsWith('/')) s = SITE + s;
  // Kill fragments + tracking params, and the legacy .html suffix that Pages
  // 308-redirects anyway.
  s = s.split('#')[0].split('?')[0];
  if (!s.startsWith('https://')) return null;
  let u;
  try { u = new URL(s); } catch (e) { return null; }
  if (u.hostname !== 'www.rigebalighting.com') return null;
  if (!u.pathname.startsWith('/content/blog/')) return null;
  let path = u.pathname.replace(/\.html$/, '');
  const slug = path.slice('/content/blog/'.length);
  if (!/^[a-z0-9][a-z0-9-]{6,120}$/.test(slug)) return null;
  return SITE + path;
}

/**
 * Read the live article so the social copy comes from the real page rather
 * than a stale local index. Also proves the link resolves (200) before we
 * hand it to Facebook's scraper.
 */
export async function readArticle(url) {
  let res;
  try {
    res = await fetch(url, {
      headers: { 'user-agent': 'RiGeBa-Content-Sync/1.0 (+https://www.rigebalighting.com)' },
      cf: { cacheTtl: 300 },
    });
  } catch (e) {
    return { ok: false, error: 'fetch failed: ' + ((e && e.message) || String(e)) };
  }
  if (!res.ok) return { ok: false, error: 'article returned HTTP ' + res.status };
  const html = await res.text();
  const meta = (key) => {
    const m = html.match(new RegExp('<meta[^>]+property=["\']' + key + '["\'][^>]*content=["\']([^"\']*)["\']', 'i'))
      || html.match(new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*property=["\']' + key + '["\']', 'i'));
    return m ? decodeEntities(m[1]) : '';
  };
  const tm = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  let title = meta('og:title') || (tm ? decodeEntities(tm[1]) : '');
  title = title.replace(/\s*\|\s*RiGeBa Lighting\s*$/i, '').trim();
  let description = meta('og:description').replace(/\s+/g, ' ').trim();
  if (description.length > 220) description = description.slice(0, 217).replace(/\s+\S*$/, '') + '...';
  const image = meta('og:image') || '';
  if (!title) return { ok: false, error: 'no og:title found on ' + url };
  return { ok: true, url, title, description, image };
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .trim();
}

/** Fallback for the "post the newest article" button in the workflow. */
export async function latestArticleUrl() {
  let res;
  try {
    res = await fetch(SITE + '/data/posts.json', { cf: { cacheTtl: 300 } });
  } catch (e) {
    return { ok: false, error: 'posts.json fetch failed: ' + ((e && e.message) || String(e)) };
  }
  if (!res.ok) return { ok: false, error: 'posts.json returned HTTP ' + res.status };
  let d;
  try { d = await res.json(); } catch (e) { return { ok: false, error: 'posts.json is not JSON' }; }
  const posts = Array.isArray(d) ? d : (d && d.posts) || [];
  if (!posts.length) return { ok: false, error: 'posts.json is empty' };
  const raw = String(posts[0].url || '');
  const u = normalizeArticleUrl(raw.startsWith('http') ? raw : '/' + raw.replace(/^\/+/, ''));
  if (!u) return { ok: false, error: 'newest post has an unexpected url: ' + raw };
  return { ok: true, url: u };
}
