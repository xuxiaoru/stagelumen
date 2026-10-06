/**
 * Homepage editor API.
 *
 * Reads and writes the flat `home*` keys in content/settings.yml, which
 * build/inject-settings.js writes into the elements marked data-set /
 * data-target in index.html. The markup keeps its own copy of every value, so a
 * bad write here degrades to the old text rather than a broken page.
 *
 * This writes the site's most important page, so every field is validated:
 *   text   - tags stripped, length capped
 *   image  - must resolve to a file that actually exists in the repository
 *   link   - on-site relative path or https, never javascript: or data:
 *
 * Auth: Authorization: Bearer <token> (or ?token=). Per-person tokens from the
 * EDITOR_TOKENS Pages variable; ADMIN_TOKEN also works. The caller's name goes
 * into the commit message.
 *
 *   GET            -> current values, plus the image list the picker offers
 *   PUT {values}   -> apply the given keys, ignore the rest
 */

import { editorWho, fail, json } from '../../_lib/util.js';
import { getLargeFile, commitBlob, ghConfigured } from '../../_lib/github.js';

const SETTINGS = 'content/settings.yml';
const BRANCH = 'main';
const IMAGE_PREFIX = 'assets/images/';
const IMAGE_EXT = /\.(jpg|jpeg|png|webp|gif|svg|avif)$/i;

/**
 * Caps by role. A headline and a paragraph do not have the same budget, and a
 * single flat limit either truncates a paragraph or lets a headline run into
 * the next block.
 */
const CAP = { title: 120, text: 400, href: 200, image: 180 };

/** Keys ending in these are treated as the shorter kinds. */
const isTitle = (k) => /Title|Eyebrow|Name(Label)?$|Label$|Lead$/.test(k);
const isImage = (k) => /Plate$|Image$/.test(k);
const isHref = (k) => /Href$/.test(k);

/** Parse the same flat top-level `key: value` pairs the build script reads. */
function parseFlat(text) {
  const out = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '');
    if (!line.trim() || /^\s/.test(line)) continue;
    const i = line.indexOf(':');
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (/^".*"$/.test(val) || /^'.*'$/.test(val)) val = val.slice(1, -1);
    if (val) out[key] = val;
  }
  return out;
}

/** Strip anything that could become markup, then collapse whitespace. */
function cleanText(v, cap) {
  return String(v == null ? '' : v)
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, cap);
}

/**
 * Only same-site links. An absolute URL has to be https; a relative one has to
 * look like a path. javascript: and data: are the payloads this is here to stop.
 */
function cleanHref(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    return /^https:\/\//i.test(s) ? s.slice(0, CAP.href) : null;
  }
  if (s.startsWith('//')) return null;
  if (!/^[\w\-./#?=&%+,:@~]+$/.test(s)) return null;
  if (s.includes('..')) return null;
  return s.slice(0, CAP.href);
}

function cleanImage(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (!s.startsWith(IMAGE_PREFIX)) return null;
  if (s.includes('..') || !IMAGE_EXT.test(s)) return null;
  return s.slice(0, CAP.image);
}

/** Does the file actually exist? A typo would otherwise ship a broken image. */
async function fileExists(env, path) {
  try {
    const r = await fetch(
      'https://api.github.com/repos/' +
        (env.GITHUB_REPO || 'xuxiaoru/stagelumen') +
        '/contents/' +
        path.split('/').map(encodeURIComponent).join('/') +
        '?ref=' + BRANCH,
      {
        headers: {
          Authorization: 'Bearer ' + env.GITHUB_PAT,
          'User-Agent': 'home-editor',
          Accept: 'application/vnd.github+json',
        },
      }
    );
    return r.status === 200;
  } catch (e) {
    return false;
  }
}

async function readSettings(env) {
  const f = await getLargeFile(env, SETTINGS, BRANCH);
  if (!f) return null;
  return { text: f.text, sha: f.sha, values: parseFlat(f.text) };
}

/** Rewrite only the `key: "value"` lines we were given, leaving the rest byte-identical. */
function applyToYaml(text, updates) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(home[A-Za-z0-9]+):\s*(.*)$/);
    if (!m || !(m[1] in updates)) continue;
    seen.add(m[1]);
    lines[i] = m[1] + ': "' + String(updates[m[1]]).replace(/"/g, "'") + '"';
  }
  const missing = Object.keys(updates).filter((k) => !seen.has(k));
  if (missing.length) {
    // A key the editor knows but the file does not have yet. Appending is safe:
    // inject-settings.js ignores what it does not recognise, and a stray key is
    // harmless, whereas guessing a section to insert into is not.
    lines.push('');
    lines.push('# added by the homepage editor');
    for (const k of missing) lines.push(k + ': "' + String(updates[k]).replace(/"/g, "'") + '"');
  }
  return lines.join('\n');
}

export async function onRequest(context) {
  const { request, env } = context;
  const who = editorWho(request, env);
  if (!who.ok) {
    return fail(env.EDITOR_TOKENS || env.ADMIN_TOKEN ? 'Unauthorized' : 'No editor token configured', 401);
  }
  if (!ghConfigured(env)) return fail('GitHub integration is not configured', 503);

  if (request.method === 'GET') {
    const s = await readSettings(env);
    if (!s) return fail('Could not read settings.yml', 502);
    const home = {};
    for (const k of Object.keys(s.values)) if (k.startsWith('home')) home[k] = s.values[k];
    return json({ ok: true, editor: who.name, values: home });
  }

  if (request.method === 'PUT' || request.method === 'POST') {
    let body = {};
    try {
      body = await request.json();
    } catch (e) {
      return fail('Body must be JSON', 400);
    }
    const incoming = body.values && typeof body.values === 'object' ? body.values : {};
    const keys = Object.keys(incoming).filter((k) => /^home[A-Za-z0-9]+$/.test(k));
    if (!keys.length) return fail('No home* keys in the patch', 400);

    const updates = {};
    const rejected = [];
    const imagesToCheck = [];

    for (const k of keys) {
      const raw = incoming[k];
      if (isImage(k)) {
        const v = cleanImage(raw);
        if (v === null) rejected.push(k + ' (not an image under ' + IMAGE_PREFIX + ')');
        else {
          updates[k] = v;
          if (v) imagesToCheck.push(v);
        }
        continue;
      }
      if (isHref(k)) {
        const v = cleanHref(raw);
        if (v === null) rejected.push(k + ' (not an on-site path or https URL)');
        else updates[k] = v;
        continue;
      }
      const cap = isTitle(k) ? CAP.title : CAP.text;
      const v = cleanText(raw, cap);
      if (raw != null && String(raw).trim() && !v) rejected.push(k + ' (empty after cleaning)');
      else updates[k] = v;
    }

    // One existence check per distinct image, in parallel.
    const distinct = [...new Set(imagesToCheck)];
    const checks = await Promise.all(distinct.map((p) => fileExists(env, p).then((ok) => [p, ok])));
    const missing = checks.filter(([, ok]) => !ok).map(([p]) => p);
    for (const p of missing) {
      delete updates[Object.keys(updates).find((k) => updates[k] === p)];
      rejected.push(p + ' (no such file in the repository)');
    }

    if (!Object.keys(updates).length) {
      return fail('Nothing usable in the patch. ' + (rejected.length ? 'Rejected: ' + rejected.join('; ') : ''), 400);
    }

    const s = await readSettings(env);
    if (!s) return fail('Could not read settings.yml', 502);

    const changed = Object.keys(updates).filter((k) => s.values[k] !== updates[k]);
    if (!changed.length) {
      return json({ ok: true, editor: who.name, changed: [], rejected, message: 'No change' });
    }

    const next = applyToYaml(s.text, updates);
    const label = changed.length > 6 ? changed.length + ' homepage fields' : changed.join(', ');
    const sha = await commitBlob(
      env,
      SETTINGS,
      next,
      'homepage: update ' + label + ' by ' + who.name,
      BRANCH
    );
    return json({ ok: true, editor: who.name, changed, rejected, commit: sha, values: updates });
  }

  return fail('Method not allowed', 405);
}
