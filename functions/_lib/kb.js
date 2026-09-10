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

/**
 * Function words that carry no retrieval signal but match almost any answer.
 * Without this filter "tell me about SL-B150" scores the company blurb highly
 * because it contains "for", "our", "and" — and the actual product loses.
 */
const STOP = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'can', 'could', 'would', 'should', 'shall', 'will',
  'may', 'might', 'must', 'i', 'me', 'my', 'we', 'our', 'us', 'you', 'your',
  'it', 'its', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'about', 'tell',
  'what', 'how', 'when', 'where', 'who', 'which', 'and', 'or', 'but', 'if',
  'have', 'has', 'had', 'there', 'here', 'this', 'that', 'these', 'those',
  'from', 'by', 'as', 'so', 'than', 'then', 'very', 'just', 'get', 'got',
  'any', 'some', 'much', 'many', 'more', 'most', 'other', 'into', 'over',
  'also', 'only', 'own', 'same', 'too', 'please', 'need', 'want', 'like',
  'know', 'thanks', 'hi', 'hello', 'hey', 'your', 'yours',
]);

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
  // The middle [a-z]{0,2} matters: catalogue codes put a series letter before
  // the number (SL-B150 = Beam 150W). Without it the regex only captures
  // "b150" and the model never matches.
  for (const m of s.match(/[a-z]{1,4}[- ]?[a-z]{0,2}\d{2,5}[a-z]?/g) || []) {
    tokens.add(m.replace(/[^a-z0-9]/g, ''));
    tokens.add(m);
  }

  return [...tokens].filter((t) => t.length >= 2 && !STOP.has(t)).slice(0, 24);
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
    return { products: [], entries: [], tokens, ok: false, modelHit: false };
  }

  // Did the buyer name a specific model? If so the product answer must win,
  // otherwise a generic FAQ entry can outrank it on incidental wording.
  let modelHit = false;
  for (const p of kb.products) {
    const m = String(p.model || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (m.length < 5) continue;
    const hit = tokens.some((t) => {
      const n = String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
      return n === m || n.includes(m);
    });
    if (hit) {
      modelHit = true;
      break;
    }
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

  return { products: prods, entries, tokens, ok: true, modelHit };
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
