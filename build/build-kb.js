/**
 * Builds data/kb-products.json — a slimmed-down, search-optimised index of the
 * catalogue.
 *
 * Why: data/products.json is ~490 KB and carries fields the assistant never
 * needs (images[], longDesc, reviews). Shipping that to every chat request
 * wastes egress and slows cold starts. This script keeps only what retrieval
 * and answering actually use, and pre-computes a lowercased haystack so the
 * runtime never has to stringify 138 products per request.
 *
 * Run:  node build/build-kb.js
 * Fails safe: exits 0 and writes nothing if the source is missing or invalid.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'data', 'products.json');
const OUT = path.join(ROOT, 'data', 'kb-products.json');

function slug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.log('[kb] source missing, skipping');
    return 0;
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  } catch (e) {
    console.log('[kb] source unreadable, skipping:', e.message);
    return 0;
  }

  const list = Array.isArray(raw) ? raw : raw.products || [];
  if (!list.length) {
    console.log('[kb] empty catalogue, skipping');
    return 0;
  }

  const items = list.map((p) => {
    const specs = Array.isArray(p.specs) ? p.specs : [];
    const specText = specs.map((s) => `${s.label || ''}: ${s.value || ''}`).join(' | ');
    const apps = Array.isArray(p.applications) ? p.applications.join(', ') : String(p.applications || '');

    const item = {
      id: p.id,
      name: p.name,
      model: p.model,
      category: p.category,
      subLabel: p.subLabel || '',
      price: typeof p.price === 'number' ? p.price : null,
      tagline: p.tagline || '',
      shortDesc: (p.shortDesc || '').slice(0, 160),
      specText: specText.slice(0, 320),
      oem: !!p.oem,
    };

    // Pre-computed haystack: the runtime just does indexOf on this string.
    // Applications are folded in here rather than stored separately — they are
    // only ever needed for matching, never for display.
    item.hay = slug(
      [item.name, item.model, item.category, item.subLabel, item.tagline,
       item.shortDesc, specText, apps].join(' ')
    );
    return item;
  });

  const payload = {
    version: '1.0',
    generated: new Date().toISOString().slice(0, 10),
    count: items.length,
    items,
  };

  fs.writeFileSync(OUT, JSON.stringify(payload), 'utf8');
  const kb = path.join(ROOT, 'data', 'kb.json');
  const kbCount = fs.existsSync(kb)
    ? (JSON.parse(fs.readFileSync(kb, 'utf8')).entries || []).length
    : 0;

  console.log(
    `[kb] indexed ${items.length} products -> ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB` +
    ` | ${kbCount} KB entries`
  );
  return 0;
}

process.exit(main());
