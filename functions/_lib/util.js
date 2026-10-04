/**
 * RiGeBa Lighting AI — shared utilities (zero dependencies)
 * Runs on Cloudflare Pages Functions (V8 isolate, Web Standards only).
 */

const BASE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
  'x-content-type-options': 'nosniff',
};

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: Object.assign({}, BASE_HEADERS, extra),
  });
}

export function ok(data, extra) {
  return json(Object.assign({ ok: true }, data), 200, extra);
}

export function fail(message, status = 400, extra = {}) {
  return json({ ok: false, error: message }, status, extra);
}

export function handleOptions() {
  return new Response(null, { status: 204, headers: BASE_HEADERS });
}

export function uid(prefix = '') {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return (prefix ? prefix + '_' : '') + t + r;
}

export function nowIso() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/** Trim + clamp a value to a safe string. Never throws. */
export function str(v, max = 2000, fallback = '') {
  if (v === null || v === undefined) return fallback;
  let s = String(v).trim();
  if (!s) return fallback;
  if (s.length > max) s = s.slice(0, max);
  return s;
}

export function int(v, fallback = 0) {
  const n = parseInt(String(v ?? '').replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
export function isEmail(v) {
  return EMAIL_RE.test(str(v, 254));
}

const FREE_MAIL = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com',
  'aol.com', 'proton.me', 'protonmail.com', 'mail.com', 'gmx.com',
  'yandex.com', 'zoho.com', 'live.com', 'msn.com', '163.com', 'qq.com',
  '126.com', 'sina.com', 'foxmail.com', 'yeah.net',
]);

export function emailDomain(email) {
  const p = str(email, 254).toLowerCase().split('@');
  return p.length === 2 ? p[1] : '';
}

export function isFreeMail(email) {
  return FREE_MAIL.has(emailDomain(email));
}

export function clientIp(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    'unknown'
  );
}

/** Best-effort country from Cloudflare's edge header. */
export function edgeCountry(request) {
  return request.headers.get('cf-ipcountry') || '';
}

/** Safely parse a JSON body; returns {} on any failure. */
export async function readBody(request) {
  const ctype = (request.headers.get('content-type') || '').toLowerCase();
  try {
    if (ctype.includes('application/json')) {
      const t = await request.text();
      return t ? JSON.parse(t) : {};
    }
    if (ctype.includes('form')) {
      const fd = await request.formData();
      const o = {};
      for (const [k, v] of fd.entries()) o[k] = String(v);
      return o;
    }
    const t = await request.text();
    return t ? JSON.parse(t) : {};
  } catch (e) {
    return {};
  }
}

/** Constant-time-ish compare for the admin token. */
export function safeEqual(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  if (sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i++) diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  return diff === 0 && sa.length > 0;
}

/**
 * Who is calling, for the product editor.
 *
 * Returns { ok, name } rather than a bare boolean, because the caller's name goes
 * into the commit message — that is the whole point of per-person tokens.
 * EDITOR_TOKENS is a JSON object of token -> name; ADMIN_TOKEN still works so the
 * repository owner cannot lock themselves out.
 */
export function editorWho(request, env) {
  const auth = request.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const query = new URL(request.url).searchParams.get('token') || '';
  const presented = bearer || query;
  if (!presented) return { ok: false, name: '' };

  let map = {};
  try {
    map = JSON.parse(env.EDITOR_TOKENS || '{}') || {};
  } catch (e) {
    map = {};
  }
  for (const tok of Object.keys(map)) {
    if (safeEqual(presented, tok)) return { ok: true, name: String(map[tok] || 'editor') };
  }
  if (env.ADMIN_TOKEN && safeEqual(presented, env.ADMIN_TOKEN)) return { ok: true, name: 'admin' };
  return { ok: false, name: '' };
}

export function adminAuthorized(request, env) {
  const token = env.ADMIN_TOKEN;
  if (!token) return false;
  const auth = request.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const query = new URL(request.url).searchParams.get('token') || '';
  return safeEqual(bearer, token) || safeEqual(query, token);
}
