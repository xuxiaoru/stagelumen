/**
 * Product editor API — one product at a time.
 *
 * Why this exists instead of editing products in Decap CMS: data/products.json
 * is 1.19 MB and GitHub's Contents API returns an empty body for anything over
 * 1 MB, so the CMS could not read the catalogue at all. This endpoint goes
 * through git/blobs instead, which is not size-limited, and it commits directly
 * to main rather than opening a pull request for a one-field price change.
 *
 * Auth: Authorization: Bearer <token>, or ?token=… for the browser.
 *   Per-person tokens come from the EDITOR_TOKENS Pages variable (a JSON object
 *   of token -> name). The shared ADMIN_TOKEN is also accepted so the repository
 *   owner is never locked out. The caller's name lands in the commit message.
 *
 *   GET  ?q=&cat=&limit=   search; returns compact rows
 *   GET  ?id=<id>          one product, full
 *   GET  ?meta=1           catalogue metadata and category labels (read only)
 *   PUT  { id, patch }     update the whitelisted fields of one product
 */

import { editorWho, fail, json } from '../../_lib/util.js';
import { getLargeFile, commitBlob, ghConfigured } from '../../_lib/github.js';

const CATALOGUE = 'data/products.json';
const BRANCH = 'main';

/**
 * What an editor is allowed to change.
 *
 * Deliberately excludes id, model, category, image and images. Those decide the
 * page URL, the file name and which static page exists; changing them from a
 * price field would silently break inbound links. A price edit must never be
 * able to rename a product.
 */
const EDITABLE = {
  name: 'string',
  tagline: 'string',
  subLabel: 'string',
  shortDesc: 'string',
  longDesc: 'string',
  price: 'number',
  moq: 'number',
  incoterm: 'string',
  oem: 'bool',
  badge: 'string',
  priority: 'number',
  features: 'stringList',
  applications: 'stringList',
  specs: 'specs',
  priceTiers: 'tiers',
};

function clean(v, kind) {
  if (kind === 'string') {
    if (v == null) return '';
    return String(v).slice(0, 4000);
  }
  if (kind === 'number') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (kind === 'bool') return !!v;
  if (kind === 'stringList') {
    if (!Array.isArray(v)) return null;
    return v
      .map((x) => String(x == null ? '' : x).trim())
      .filter(Boolean)
      .slice(0, 30)
      .map((x) => x.slice(0, 300));
  }
  if (kind === 'specs') {
    if (!Array.isArray(v)) return null;
    return v
      .filter((s) => s && typeof s === 'object')
      .slice(0, 40)
      .map((s) => ({ label: String(s.label == null ? '' : s.label).slice(0, 120), value: String(s.value == null ? '' : s.value).slice(0, 400) }))
      .filter((s) => s.label);
  }
  if (kind === 'tiers') {
    if (!Array.isArray(v)) return null;
    return v
      .filter((t) => t && typeof t === 'object')
      .slice(0, 12)
      .map((t) => ({
        qty: String(t.qty == null ? '' : t.qty).slice(0, 60),
        price: String(t.price == null ? '' : t.price).slice(0, 60),
      }))
      .filter((t) => t.qty);
  }
  return null;
}

async function readCatalogue(env) {
  const file = await getLargeFile(env, CATALOGUE, BRANCH);
  if (!file) return null;
  try {
    return { data: JSON.parse(file.text), sha: file.sha };
  } catch (e) {
    return null;
  }
}

/** Substring match across the fields an operator would actually search by. */
function matches(p, q) {
  if (!q) return true;
  const s = String(q).toLowerCase();
  return [p.model, p.name, p.id, p.subLabel, p.tagline, p.shortDesc]
    .filter(Boolean)
    .some((f) => String(f).toLowerCase().includes(s));
}

function row(p) {
  return {
    id: p.id,
    model: p.model,
    name: p.name,
    category: p.category,
    subLabel: p.subLabel || '',
    price: p.price == null ? null : p.price,
    moq: p.moq == null ? null : p.moq,
    currency: p.currency || 'USD',
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const who = editorWho(request, env);
  if (!who.ok) {
    return fail(env.EDITOR_TOKENS || env.ADMIN_TOKEN ? 'Unauthorized' : 'No editor token configured', 401);
  }
  if (!ghConfigured(env)) return fail('GitHub integration is not configured', 503);

  const url = new URL(request.url);

  if (request.method === 'GET') {
    const cat = await readCatalogue(env);
    if (!cat) return fail('Could not read the catalogue', 502);
    const data = cat.data || {};

    if (url.searchParams.get('meta')) {
      return json({
        ok: true,
        editor: who.name,
        meta: data.meta || {},
        categories: data.categories || {},
        total: (data.products || []).length,
      });
    }

    const id = url.searchParams.get('id');
    if (id) {
      const p = (data.products || []).find((x) => x.id === id);
      if (!p) return fail('No such product: ' + id, 404);
      return json({ ok: true, editor: who.name, product: p });
    }

    const q = (url.searchParams.get('q') || '').trim();
    const category = url.searchParams.get('cat') || '';
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    let list = (data.products || []).filter((p) => matches(p, q));
    if (category) list = list.filter((p) => p.category === category);
    return json({
      ok: true,
      editor: who.name,
      total: (data.products || []).length,
      matched: list.length,
      products: list.slice(0, limit).map(row),
    });
  }

  if (request.method === 'PUT' || request.method === 'POST') {
    let body = {};
    try {
      body = await request.json();
    } catch (e) {
      return fail('Body must be JSON', 400);
    }
    const id = String(body.id || '').trim();
    const patch = body.patch && typeof body.patch === 'object' ? body.patch : {};
    if (!id) return fail('id is required', 400);

    const keys = Object.keys(patch).filter((k) => k in EDITABLE);
    const rejected = Object.keys(patch).filter((k) => !(k in EDITABLE));
    if (!keys.length) {
      return fail('Nothing editable in the patch. Editable fields: ' + Object.keys(EDITABLE).join(', '), 400);
    }

    const cat = await readCatalogue(env);
    if (!cat) return fail('Could not read the catalogue', 502);
    const products = (cat.data.products || []);
    const idx = products.findIndex((p) => p.id === id);
    if (idx < 0) return fail('No such product: ' + id, 404);

    const before = products[idx];
    const next = { ...before };
    const changed = [];
    for (const k of keys) {
      const v = clean(patch[k], EDITABLE[k]);
      if (v === null) continue;
      if (JSON.stringify(before[k]) === JSON.stringify(v)) continue;
      next[k] = v;
      changed.push(k);
    }
    if (!changed.length) {
      return json({ ok: true, editor: who.name, changed: [], product: next, message: 'No change' });
    }

    // shortDesc repeats the model and price in most rows; keep it consistent so
    // an edited price does not leave a stale sentence behind on the page.
    if (changed.includes('price') && typeof next.shortDesc === 'string' && /\$[\d,]+/.test(next.shortDesc)) {
      const sym = before.currency === 'EUR' ? '€' : '$';
      const v = typeof next.price === 'number' ? next.price.toLocaleString('en-US') : next.price;
      next.shortDesc = next.shortDesc.replace(/[$€£]\s?[\d,]+/g, sym + v);
    }

    products[idx] = next;
    const out = { ...cat.data, products };
    const message =
      'product: update ' + String(before.model || id) + ' (' + changed.join(', ') + ') by ' + who.name;
    const sha = await commitBlob(env, CATALOGUE, JSON.stringify(out, null, 2) + '\n', message, BRANCH);

    return json({
      ok: true,
      editor: who.name,
      changed,
      ignored: rejected,
      commit: sha,
      product: next,
    });
  }

  return fail('Method not allowed', 405);
}
