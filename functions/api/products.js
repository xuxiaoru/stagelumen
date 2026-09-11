import { ok, fail, adminAuthorized } from '../_lib/util.js';
import { csvToObjects } from '../_lib/csv.js';
import {
  ghConfigured, mainSha, createBranch, putFile, putBinary, openPr, getFile,
} from '../_lib/github.js';

/**
 * Bulk product import.
 *
 * POST /api/products  (admin)
 *   { csv: "model,name,price,image\nSL-X1,...,..." }
 *   { images: [ { name: "sl-x1.jpg", dataUrl: "data:image/jpeg;base64,..." } ] }
 *
 * Never writes to main. Reads data/products.json from the repo, merges by
 * model, commits both the images and the catalogue to a new branch, opens a PR.
 */

const CATALOGUE = 'data/products.json';
const IMG_DIR = 'assets/images/products/';

// Aliases are matched against a normalised header (lowercase, no spaces,
// underscores or hyphens) so spreadsheet column names can be human.
const FIELDS = {
  model: ['model', 'sku', 'modelno', 'modelnumber', 'itemno', 'partno'],
  name: ['name', 'productname', 'title'],
  category: ['category', 'cat', 'family'],
  sub: ['sub', 'subcategory', 'type', 'subtype'],
  subLabel: ['sublabel'],
  price: ['price', 'usd', 'unitprice', 'listprice'],
  tagline: ['tagline'],
  shortDesc: ['shortdesc', 'summary', 'description', 'desc'],
  longDesc: ['longdesc', 'details', 'detail', 'fulldescription'],
  image: ['image', 'imageurl', 'photo', 'picture', 'mainimage', 'img'],
  images: ['images', 'gallery', 'photos', 'moreimages'],
  badge: ['badge'],
  applications: ['applications', 'application', 'usage'],
  features: ['features', 'feature'],
  specs: ['specs', 'specifications', 'parameters'],
  icon: ['icon'],
  iconColor: ['iconcolor'],
};

const LIST_FIELDS = new Set(['images', 'applications', 'features']);

function pick(row, key) {
  for (const alias of FIELDS[key] || [key]) {
    const v = row[alias];
    if (v !== undefined && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function toNumber(v) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function toList(v) {
  return String(v || '')
    .split(/[;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// specs: "Light Source: 400W LED; Beam Angle: 2-45°" -> [{label, value}]
function toSpecs(v) {
  const out = [];
  for (const part of String(v || '').split(/[;|]/)) {
    const s = part.trim();
    if (!s) continue;
    const i = s.indexOf(':');
    if (i < 1) continue;
    out.push({ label: s.slice(0, i).trim(), value: s.slice(i + 1).trim() });
  }
  return out;
}

function normModel(m) {
  return String(m || '').trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Parse an uploaded filename into candidate SKUs plus a sort order.
 *
 *   SL-B150.jpg    -> exact 'SL-B150',  root null,      order 0
 *   SL-B150-2.jpg  -> exact 'SL-B150-2', root 'SL-B150', order 2
 *   SL-B150_3.jpg  -> exact 'SL-B150-3', root 'SL-B150', order 3
 *   SL-B150-b.jpg  -> exact 'SL-B150-B', root 'SL-B150', order 2
 *
 * Both candidates are returned rather than one answer, because a SKU that
 * genuinely ends in a short number (SL-B15) would otherwise be truncated to
 * SL-B. The caller checks the catalogue: exact wins if it exists, otherwise
 * fall back to root.
 */
function splitImageName(filename) {
  const base = String(filename || '').replace(/\.[a-z0-9]+$/i, '');
  const m = /^(.*?)[-_ ](\d{1,2}|[a-z])$/i.exec(base);
  if (!m) return { exact: normModel(base), root: null, order: 0 };

  const tail = m[2];
  const order = /^\d+$/.test(tail)
    ? parseInt(tail, 10)
    : tail.toLowerCase().charCodeAt(0) - 96;
  return { exact: normModel(base), root: normModel(m[1]), order };
}

function blankProduct(row) {
  const model = pick(row, 'model');
  return {
    id: String(model).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: pick(row, 'name') || model,
    model,
    category: pick(row, 'category'),
    sub: pick(row, 'sub'),
    subLabel: pick(row, 'subLabel') || pick(row, 'sub'),
    family: pick(row, 'category'),
    price: toNumber(pick(row, 'price')),
    badge: pick(row, 'badge') || null,
    rating: 0,
    reviews: 0,
    sold: '',
    icon: pick(row, 'icon') || '◉',
    iconColor: pick(row, 'iconColor') || '#ff6b00',
    tagline: pick(row, 'tagline'),
    shortDesc: pick(row, 'shortDesc'),
    longDesc: pick(row, 'longDesc'),
    specs: toSpecs(pick(row, 'specs')),
    features: toList(pick(row, 'features')),
    applications: toList(pick(row, 'applications')),
    priority: 99,
    phase: 'live',
    hero: false,
    oem: true,
    image: pick(row, 'image'),
    images: toList(pick(row, 'images')),
  };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!adminAuthorized(request, env)) {
    return fail(env.ADMIN_TOKEN ? 'Unauthorized' : 'ADMIN_TOKEN is not configured', 401);
  }

  if (!ghConfigured(env)) {
    return fail('GITHUB_PAT is not configured. Add it in Pages settings, then redeploy.', 503);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return fail('Expected a JSON body.', 400);
  }

  const rows = csvToObjects(payload.csv);
  const images = Array.isArray(payload.images) ? payload.images : [];

  // Either input alone is valid: a catalogue edit with no new photos, or a
  // photo drop that only updates images on SKUs that already exist.
  if (!rows.length && !images.length) {
    return fail('Nothing to import — supply CSV rows and/or images.', 400);
  }

  // --- merge against the live catalogue -------------------------------------
  const current = await getFile(env, CATALOGUE);
  if (!current) return fail('Could not read ' + CATALOGUE + ' from the repository.', 502);

  let catalogue;
  try {
    catalogue = JSON.parse(current.text);
  } catch (e) {
    return fail(CATALOGUE + ' is not valid JSON — refusing to overwrite it.', 502);
  }

  const list = Array.isArray(catalogue) ? catalogue : catalogue.products;
  if (!Array.isArray(list)) return fail(CATALOGUE + ' has no product array.', 502);

  const byModel = new Map(list.map((p) => [normModel(p.model), p]));

  // --- uploaded images ------------------------------------------------------
  // Files are collected here but bound to SKUs only after the CSV rows are
  // applied, so a brand-new SKU in the same import can receive its photos.
  const imageFiles = [];
  const imageErrors = [];

  for (const img of images) {
    const name = String(img.name || '').trim();
    const dataUrl = String(img.dataUrl || '');
    const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
    if (!name || !m) {
      imageErrors.push((name || '(unnamed)') + ': not a base64 data URL');
      continue;
    }
    const safe = name
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '-')
      .replace(/-+/g, '-');
    imageFiles.push({
      path: IMG_DIR + safe,
      base64: m[2],
      ...splitImageName(name),
    });
  }

  // --- apply rows -----------------------------------------------------------
  let created = 0;
  let updated = 0;
  const skipped = [];

  for (const row of rows) {
    const model = pick(row, 'model');
    if (!model) {
      skipped.push('row without a model/sku column');
      continue;
    }
    const key = normModel(model);
    const existing = byModel.get(key);

    if (existing) {
      const draft = blankProduct(row);
      for (const k of Object.keys(draft)) {
        const v = draft[k];
        if (v === '' || v === null || v === undefined) continue;
        if (Array.isArray(v) && !v.length) continue;
        existing[k] = v;
      }
      updated++;
    } else {
      const p = blankProduct(row);
      byModel.set(key, p);
      list.push(p);
      created++;
    }
  }

  // --- bind images, now that newly created SKUs exist ------------------------
  const grouped = new Map();

  for (const f of imageFiles) {
    // Prefer the literal filename; only fall back to the stripped root when
    // the literal form is not a known SKU.
    const sku = byModel.has(f.exact)
      ? f.exact
      : (f.root && byModel.has(f.root) ? f.root : f.exact);
    if (!grouped.has(sku)) grouped.set(sku, []);
    grouped.get(sku).push(f);
  }

  let linked = 0;

  for (const [sku, files] of grouped) {
    const target = byModel.get(sku);
    if (!target) {
      imageErrors.push(
        files.map((f) => f.path.split('/').pop()).join(', ') +
          ': no SKU named "' + sku + '" — file committed but not linked'
      );
      continue;
    }

    files.sort((a, b) => a.order - b.order);
    const paths = files.map((f) => f.path);

    // First image becomes the cover; the full set goes into the gallery,
    // newest first, without duplicating anything already listed.
    target.image = paths[0];
    const rest = Array.isArray(target.images) ? target.images : [];
    target.images = [...new Set([...paths, ...rest])];
    linked++;
  }

  if (!created && !updated && !imageFiles.length) {
    return fail('Nothing to import — no rows matched and no images supplied.', 400);
  }

  // --- commit ---------------------------------------------------------------
  const branch = 'ai/products-' + Date.now().toString(36);
  const stamp = new Date().toISOString().slice(0, 10);

  try {
    const sha = await mainSha(env);
    if (!sha) throw new Error('could not resolve main sha');
    await createBranch(env, branch, sha);

    for (const f of imageFiles) {
      await putBinary(env, f.path, f.base64, branch, 'Add product image ' + f.path.split('/').pop());
    }

    const next = Array.isArray(catalogue)
      ? list
      : { ...catalogue, products: list };
    await putFile(
      env,
      CATALOGUE,
      JSON.stringify(next, null, 2),
      branch,
      `Update product catalogue (${created} new, ${updated} updated) — ${stamp}`,
      current.sha
    );

    const pr = await openPr(env, {
      title: `Catalogue import: ${created} new, ${updated} updated`,
      body: [
        'Generated by the admin product importer.',
        '',
        `- New SKUs: **${created}**`,
        `- Updated SKUs: **${updated}**`,
        `- Images committed: **${imageFiles.length}** across **${linked}** SKU(s)`,
        '',
        '**Review before merging** — check prices, specs and that every image path resolves.',
        imageErrors.length ? '\nSkipped images:\n' + imageErrors.map((e) => '- ' + e).join('\n') : '',
      ].join('\n'),
      head: branch,
    });

    return ok({
      branch,
      pr,
      created,
      updated,
      images: imageFiles.length,
      linked,
      total: list.length,
      skipped,
      imageErrors,
    });
  } catch (e) {
    return fail('Import failed: ' + String((e && e.message) || e).slice(0, 300), 502);
  }
}
