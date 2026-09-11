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
  if (!rows.length) {
    return fail('No usable rows found. The CSV needs a header row and at least one data row.', 400);
  }

  const images = Array.isArray(payload.images) ? payload.images : [];

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

  // --- uploaded images: commit files, then wire them onto matching SKUs -----
  const imageFiles = [];
  const imageByModel = new Map();
  const imageErrors = [];

  for (const img of images) {
    const name = String(img.name || '').trim();
    const dataUrl = String(img.dataUrl || '');
    const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
    if (!name || !m) {
      imageErrors.push(name || '(unnamed)' + ': not a base64 data URL');
      continue;
    }
    const ext = (name.match(/\.([a-z0-9]+)$/i) || [, 'jpg'])[1].toLowerCase();
    const safe = name
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '-')
      .replace(/-+/g, '-');
    const path = IMG_DIR + safe;
    imageFiles.push({ path, base64: m[2] });
    imageByModel.set(normModel(name.replace(/\.[a-z0-9]+$/i, '')), path);
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

    const imgPath = imageByModel.get(key);
    if (imgPath) {
      const target = byModel.get(key);
      target.image = imgPath;
      if (!Array.isArray(target.images)) target.images = [];
      if (!target.images.includes(imgPath)) target.images.unshift(imgPath);
    }
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
      `Update product catalogue (${created} new, ${updated} updated) — ${stamp}`
    );

    const pr = await openPr(env, {
      title: `Catalogue import: ${created} new, ${updated} updated`,
      body: [
        'Generated by the admin product importer.',
        '',
        `- New SKUs: **${created}**`,
        `- Updated SKUs: **${updated}**`,
        `- Images committed: **${imageFiles.length}**`,
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
      total: list.length,
      skipped,
      imageErrors,
    });
  } catch (e) {
    return fail('Import failed: ' + String((e && e.message) || e).slice(0, 300), 502);
  }
}
