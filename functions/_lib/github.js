/**
 * GitHub content pipeline: AI writes -> branch -> commit -> pull request.
 *
 * Nothing is ever pushed straight to main. Decap CMS is configured with
 * editorial_workflow, and this module deliberately respects that: generated
 * drafts land on a branch and wait for a human to merge. That keeps the
 * "AI proposes, human disposes" guarantee from the strategy doc enforced by
 * the code rather than by good intentions.
 *
 * Requires env.GITHUB_PAT (fine-grained token, Contents + PR read/write).
 */

const API = 'https://api.github.com';

export function ghConfigured(env) {
  return !!(env && env.GITHUB_PAT);
}

function repo(env) {
  return String((env && env.GITHUB_REPO) || 'xuxiaoru/stagelumen');
}

function headers(env) {
  return {
    authorization: 'Bearer ' + env.GITHUB_PAT,
    accept: 'application/vnd.github+json',
    'user-agent': 'stagelumen-ai',
    'content-type': 'application/json',
  };
}

/** UTF-8 safe base64 — btoa() alone throws on non-ASCII content. */
function b64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function gh(env, path, opts = {}) {
  const res = await fetch(API + path, { ...opts, headers: headers(env) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
  if (!res.ok) {
    const msg = (data && data.message) || ('HTTP ' + res.status);
    throw new Error('GitHub ' + path + ' -> ' + msg);
  }
  return data;
}

export async function mainSha(env, branch = 'main') {
  const ref = await gh(env, `/repos/${repo(env)}/git/ref/heads/${branch}`);
  return ref.object && ref.object.sha;
}

export async function createBranch(env, name, fromSha) {
  await gh(env, `/repos/${repo(env)}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: 'refs/heads/' + name, sha: fromSha }),
  });
  return name;
}

/** Creates or updates a single file. `sha` is required only for updates. */
export async function putFile(env, path, content, branch, message) {
  const body = { message, content: b64(content), branch };
  const res = await fetch(API + `/repos/${repo(env)}/contents/${encodeURI(path)}`, {
    method: 'PUT',
    headers: headers(env),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('put ' + path + ' -> ' + ((data && data.message) || res.status));
  return data;
}

export async function openPr(env, { title, body, head, base = 'main' }) {
  const pr = await gh(env, `/repos/${repo(env)}/pulls`, {
    method: 'POST',
    body: JSON.stringify({ title, body, head, base }),
  });
  return { number: pr.number, url: pr.html_url };
}

/**
 * One-shot: branch off main, commit every file, open a PR.
 * @returns {{branch:string, pr:{number:number,url:string}}}
 */
export async function proposeFiles(env, { branch, files, title, body }) {
  const sha = await mainSha(env);
  if (!sha) throw new Error('could not resolve main sha');

  await createBranch(env, branch, sha);

  for (const f of files) {
    await putFile(env, f.path, f.content, branch, f.message || title);
  }

  const pr = await openPr(env, { title, body, head: branch, base: 'main' });
  return { branch, pr };
}

/** kebab-case slug from a title, with a short hash to avoid collisions. */
export function slugify(title) {
  const base = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 70)
    .replace(/^-|-$/g, '');
  const tail = Math.random().toString(36).slice(2, 6);
  return base ? base + '-' + tail : 'post-' + tail;
}
