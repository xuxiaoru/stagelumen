/**
 * Image library maintenance (admin only)
 *
 *   GET  /api/media            -> every file in assets/images/products, with
 *                                 which SKU (if any) and which page references it
 *   POST /api/media {files:[]} -> delete files on a branch and open a PR
 *
 * The library is read straight from GitHub at request time — no build step,
 * no generated index to drift out of sync. Results are cached in the isolate
 * for 10 minutes because a full scan costs ~6 GitHub API calls.
 *
 * Deleting is deliberately two-step: files never vanish from main directly,
 * they leave through a pull request, the same rule as every other write path
 * in this project. Files still referenced by a SKU or a page are refused.
 */

import {
  ok, fail, handleOptions, adminAuthorized, readBody,
} from '../_lib/util.js';
import {
  getFile, listDir, deleteFile, mainSha, createBranch, openPr, ghConfigured,
} from '../_lib/github.js';

const IMG_DIR = 'assets/images/products';

// Pages that may embed an image directly (news cards, case studies, hero art).
// A file matched here is not an orphan even if no SKU points at it.
const PAGE_FILES = [
  'index.html',
  'news.html',
  'projects.html',
  'solutions.html',
  'about.html',
  'oem-odm.html',
  'data/posts.json',
];

const NAME_RE = /^[A-Za-z0-9._-]+$/;
const MAX_DELETE = 30;
const TTL = 10 * 60 * 1000;

let CACHE = { at: 0, data: null };

function basename(p) {
  return String(p || '').split('?')[0].split('/').pop();
}

function parseProducts(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { return []; }
  return Array.isArray(data) ? data : (data && Array.isArray(data.products) ? data.products : []);
}

/** Collect every image filename a SKU points at. */
function imageRefs(p) {
  const out = [];
  const push = (v) => {
    if (!v) return;
    String(v).split(/[;,]/).forEach((x) => {
      const b = basename(x.trim());
      if (b) out.push(b);
    });
  };
  push(p.image);
  push(p.thumbnail);
  if (Array.isArray(p.images)) p.images.forEach(push);
  else push(p.images);
  return out;
}

async function buildIndex(env) {
  const [dir, prodFile] = await Promise.all([
    listDir(env, IMG_DIR),
    getFile(env, 'data/products.json'),
  ]);

  const products = prodFile ? parseProducts(prodFile.text) : [];
  const usedBy = new Map();
  products.forEach((p) => {
    const model = p.model || p.sku || p.name || '?';
    imageRefs(p).forEach((f) => {
      if (!usedBy.has(f)) usedBy.set(f, new Set());
      usedBy.get(f).add(model);
    });
  });

  // Page-level references. Small files, fetched in parallel, cached hard.
  const pageTexts = [];
  await Promise.all(PAGE_FILES.map(async (f) => {
    const r = await getFile(env, f).catch(() => null);
    if (r && r.text) pageTexts.push(r.text);
  }));

  let totalBytes = 0;
  let orphanBytes = 0;

  const files = dir
    .filter((d) => d.type === 'file')
    .map((d) => {
      totalBytes += d.size || 0;
      const models = Array.from(usedBy.get(d.name) || []);
      const pageRef = pageTexts.some((t) => t.indexOf(d.name) !== -1);
      const orphan = !models.length && !pageRef;
      if (orphan) orphanBytes += d.size || 0;
      return {
        name: d.name,
        size: d.size || 0,
        url: '/assets/images/products/' + d.name,
        sha: d.sha,
        used_by: models,
        page_ref: pageRef,
        orphan,
      };
    })
    .sort((a, b) => (a.orphan === b.orphan ? b.size - a.size : a.orphan ? -1 : 1));

  return {
    generated_at: new Date().toISOString(),
    dir: IMG_DIR,
    count: files.length,
    total_bytes: totalBytes,
    orphan_count: files.filter((f) => f.orphan).length,
    orphan_bytes: orphanBytes,
    sku_count: products.length,
    files,
  };
}

async function index(env, force) {
  const fresh = CACHE.data && Date.now() - CACHE.at < TTL;
  if (fresh && !force) return CACHE.data;
  const data = await buildIndex(env);
  CACHE = { at: Date.now(), data };
  return data;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleOptions();

  if (!adminAuthorized(request, env)) {
    return fail(env.ADMIN_TOKEN ? 'Unauthorized' : 'ADMIN_TOKEN is not configured', 401);
  }
  if (!ghConfigured(env)) {
    return fail('GITHUB_PAT is not configured — the library cannot be read or changed', 503);
  }

  // ---- list --------------------------------------------------------------
  if (request.method === 'GET') {
    const force = new URL(request.url).searchParams.get('refresh') === '1';
    try {
      return ok(await index(env, force));
    } catch (e) {
      return fail('Library scan failed: ' + String((e && e.message) || e).slice(0, 300), 502);
    }
  }

  // ---- delete ------------------------------------------------------------
  if (request.method === 'POST') {
    const body = await readBody(request);
    const names = Array.isArray(body.files) ? body.files : [];
    if (!names.length) return fail('files[] is required', 422);
    if (names.length > MAX_DELETE) return fail('Max ' + MAX_DELETE + ' files per request', 422);

    const bad = names.filter((n) => !NAME_RE.test(String(n)));
    if (bad.length) return fail('Illegal file name: ' + bad.join(', '), 422);

    let idx;
    try {
      idx = await index(env, false);
    } catch (e) {
      return fail('Library scan failed: ' + String((e && e.message) || e).slice(0, 300), 502);
    }

    const byName = new Map(idx.files.map((f) => [f.name, f]));
    const missing = names.filter((n) => !byName.has(n));
    if (missing.length) return fail('Not in library: ' + missing.join(', '), 404);

    // Safety: refuse anything a SKU or a page still points at, unless forced.
    const locked = names.filter((n) => {
      const f = byName.get(n);
      return f && (f.used_by.length > 0 || f.page_ref);
    });
    if (locked.length && !body.force) {
      const detail = locked.map((n) => {
        const f = byName.get(n);
        return n + (f.used_by.length ? ' (SKU: ' + f.used_by.join(', ') + ')' : ' (page)');
      });
      return fail('Still referenced, delete the reference first: ' + detail.join('; '), 409);
    }

    const freed = names.reduce((s, n) => s + (byName.get(n).size || 0), 0);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
    const branch = 'media/clean-' + stamp;

    try {
      const sha = await mainSha(env);
      if (!sha) throw new Error('could not resolve main sha');
      await createBranch(env, branch, sha);

      const removed = [];
      for (const n of names) {
        // Re-read the sha on the branch: it must match the blob being deleted.
        await deleteFile(env, IMG_DIR + '/' + n, branch, 'chore(media): remove unused ' + n, byName.get(n).sha);
        removed.push(n);
      }

      const mb = (b) => (b / 1048576).toFixed(2) + ' MB';
      const pr = await openPr(env, {
        title: 'Remove ' + removed.length + ' unused image' + (removed.length === 1 ? '' : 's') + ' (' + mb(freed) + ')',
        body:
          '## Image library clean-up\n\n' +
          'Triggered from `/admin/media.html`.\n\n' +
          '- Directory: `' + IMG_DIR + '`\n' +
          '- Files removed: **' + removed.length + '**\n' +
          '- Space released: **' + mb(freed) + '**\n\n' +
          'None of these were referenced by a SKU in `data/products.json` or by a page.\n\n' +
          '### Files\n\n' +
          removed.map((n) => '- `' + n + '` — ' + ((byName.get(n).size || 0) / 1024).toFixed(0) + ' KB').join('\n') +
          '\n\n> Deleted files stay in git history and can be restored from a commit before this PR.',
        head: branch,
        base: 'main',
      });

      // The next scan must not serve the pre-delete cache.
      CACHE = { at: 0, data: null };

      return ok({
        removed,
        freed_bytes: freed,
        branch,
        pr: { number: pr.number, url: pr.url },
        note: 'Files are removed from the branch only. Merge the PR to publish the change.',
      });
    } catch (e) {
      return fail('Delete failed: ' + String((e && e.message) || e).slice(0, 300), 502);
    }
  }

  return fail('Method not allowed', 405);
}
