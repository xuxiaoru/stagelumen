/**
 * Knowledge base: retrieval over the catalogue index + editorial FAQ entries.
 *
 * No Vectorize, no embeddings, no dependencies. With ~140 SKUs and a couple of
 * dozen FAQ entries, scored keyword matching is both fast enough and far more
 * predictable than a vector store — and it costs nothing.
 *
 * Design rules:
 *  - Retrieval never blocks a reply. If the index is unavailable, callers get
 *    an empty result set and the assistant says it does not know.
 *  - Nothing here invents facts. Facts come from data/kb.json (extracted from
 *    published site content) and data/kb-products.json (built from the
 *    catalogue). If a question has no supporting entry, we return nothing and
 *    the assistant routes the buyer to an RFQ.
 */

const TTL_MS = 10 * 60 * 1000;

let cache = null;
let cacheAt = 0;
let inflight = null;

/** English words, CJK bigrams, and the raw query for phrase-level matching. */
export function tokenize(q) {
  const s = String(q || '').toLowerCase().trim();
  if (!s) return [];

  const tokens = new Set();
  const raw = s.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (raw) tokens.add(raw);

  for (const w of raw.split(/\s+/)) {
    const t = w.trim();
    if (t.length >= 2) tokens.add(t);
  }

  // CJK: split runs into bigrams so "户外防水" still matches "防水".
  const runs = s.match(/[\u4e00-\u9fff\u3400-\u4dbf]+/g) || [];
  for (const run of runs) {
    if (run.length >= 2) tokens.add(run);
    for (let i = 0; i + 2 <= run.length; i++) tokens.add(run.slice(i, i + 2));
  }

  // Model codes such as "sl-b150" or "slb150".
  for (const m of s.match(/[a-z]{1,4}[- ]?\d{2,5}[a-z]?/g) || []) {
    tokens.add(m.replace(/[- ]/g, ''));
    tokens.add(m);
  }

  return [...tokens].filter((t) => t.length >= 2).slice(0, 24);
}

async function fetchJson(request, file) {
  const url = new URL('/data/' + file, request.url);
  const res = await fetch(url.toString(), { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(file + ' -> HTTP ' + res.status);
  return res.json();
}

/**
 * Loads both indexes. Cached in the isolate for TTL_MS so a CMS edit to
 * kb.json goes live within ten minutes without a redeploy.
 */
export async function loadKb(request) {
  const now = Date.now();
  if (cache && now - cacheAt < TTL_MS) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const [prod, faq] = await Promise.all([
        fetchJson(request, 'kb-products.json').catch(() => ({ items: [] })),
        fetchJson(request, 'kb.json').catch(() => ({ entries: [] })),
      ]);
      cache = {
        products: Array.isArray(prod.items) ? prod.items : [],
        entries: Array.isArray(faq.entries) ? faq.entries : [],
      };
      cacheAt = Date.now();
      return cache;
    } catch (e) {
      // Never throw: an unreadable KB degrades to "I don't know", not a 500.
      cache = { products: [], entries: [] };
      cacheAt = Date.now();
      return cache;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

function scoreProduct(item, tokens, raw) {
  const hay = item.hay || '';
  const model = String(item.model || '').toLowerCase();
  const name = String(item.name || '').toLowerCase();
  let score = 0;

  if (raw) {
    if (model && model.replace(/[- ]/g, '') === raw.replace(/[- ]/g, '')) score += 120;
    else if (model && raw.includes(model)) score += 60;
    if (name.includes(raw)) score += 30;
  }
  for (const t of tokens) {
    if (model && model.replace(/[- ]/g, '').includes(t.replace(/[- ]/g, ''))) score += 25;
    else if (name.includes(t)) score += 12;
    else if (hay.includes(t)) score += 6;
  }
  return score;
}

function scoreEntry(e, tokens, raw) {
  let score = 0;
  const q = String(e.q || '').toLowerCase();
  const a = String(e.a || '').toLowerCase();
  const tags = (Array.isArray(e.tags) ? e.tags : []).map((t) => String(t).toLowerCase());

  for (const t of tokens) {
    if (tags.some((x) => x === t)) score += 30;
    else if (tags.some((x) => x.includes(t))) score += 18;
    else if (q.includes(t)) score += 12;
    else if (a.includes(t)) score += 4;
  }
  if (raw && q.includes(raw)) score += 20;
  return score;
}

/**
 * @returns {{products: Array, entries: Array, tokens: string[], ok: boolean}}
 *   ok=false means the KB was empty or unreachable — callers must not let the
 *   model answer factual questions in that state.
 */
export async function search(request, query, opts = {}) {
  const topK = opts.topK || 4;
  const kb = await loadKb(request);
  const raw = String(query || '').toLowerCase().trim();
  const tokens = tokenize(query);

  if (!kb.products.length && !kb.entries.length) {
    return { products: [], entries: [], tokens, ok: false };
  }

  const prods = kb.products
    .map((p) => ({ p, s: scoreProduct(p, tokens, raw) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, topK)
    .map((x) => x.p);

  const entries = kb.entries
    .map((e) => ({ e, s: scoreEntry(e, tokens, raw) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map((x) => x.e);

  return { products: prods, entries, tokens, ok: true };
}

/** Compact, model-ready rendering of retrieved facts. */
export function renderFacts(result) {
  const lines = [];
  for (const e of result.entries) {
    lines.push(`Q: ${e.q}\nA: ${e.a}`);
  }
  for (const p of result.products) {
    lines.push(
      `PRODUCT ${p.model} — ${p.name}\n` +
        `Price: ${p.price != null ? 'USD ' + p.price : 'on request'}\n` +
        `${p.shortDesc || ''}\n` +
        `Specs: ${p.specText || 'n/a'}`
    );
  }
  return lines.join('\n\n');
}
