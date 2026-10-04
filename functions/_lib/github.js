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

/**
 * Read-only credential check. A PAT can be present and still be wrong — the
 * only way to know is to ask GitHub. Safe to call from a diagnostic endpoint:
 * the repo is public, so nothing here is a secret.
 */
export async function ghProbe(env) {
  if (!ghConfigured(env)) return { ok: false, error: 'GITHUB_PAT is not set' };
  try {
    const r = await gh(env, `/repos/${repo(env)}`);
    return {
      ok: true,
      repo: r.full_name || repo(env),
      permissions: r.permissions
        ? { admin: !!r.permissions.admin, push: !!r.permissions.push, pull: !!r.permissions.pull }
        : null,
    };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 200) };
  }
}

/**
 * Read a text file from the repo. Returns null for 404 so callers can decide
 * whether a missing file is fatal.
 */
export async function getFile(env, path, branch = 'main') {
  try {
    const r = await gh(env, `/repos/${repo(env)}/contents/${path}?ref=${encodeURIComponent(branch)}`);
    if (!r || r.type !== 'file' || !r.content) return null;
    const bin = atob(String(r.content).replace(/\s/g, ''));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return { text: new TextDecoder().decode(bytes), sha: r.sha };
  } catch (e) {
    if (/404|Not Found/i.test(String(e && e.message))) return null;
    throw e;
  }
}

/**
 * Read a file of any size.
 *
 * The Contents API caps the body it will return at 1 MB; past that it answers
 * `encoding: "none"` with no content at all, which is why getFile() returns null
 * for data/products.json (1.19 MB). The sha is still in that response, so the
 * blob is fetched separately — git/blobs serves up to 100 MB.
 */
export async function getLargeFile(env, path, branch = 'main') {
  const r = await gh(env, `/repos/${repo(env)}/contents/${path}?ref=${encodeURIComponent(branch)}`);
  if (!r || r.type !== 'file') return null;
  if (r.content && r.encoding === 'base64') {
    const bin = atob(String(r.content).replace(/\s/g, ''));
    return { text: new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))), sha: r.sha };
  }
  const blob = await gh(env, `/repos/${repo(env)}/git/blobs/${r.sha}`);
  const bin = atob(String(blob.content || '').replace(/\s/g, ''));
  return { text: new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))), sha: r.sha };
}

/**
 * Commit a file straight to a branch, sized however large it is.
 *
 * blob -> tree -> commit -> ref, which is what push_batch.py does locally. Used
 * for single-field edits to the catalogue, where opening a 632-item pull request
 * for one price change is not useful. The ref is moved with force:false, so a
 * non-fast-forward is rejected rather than overwriting history; that is the
 * signal to re-read and retry.
 */
export async function commitBlob(env, path, content, message, branch = 'main') {
  const owner = repo(env);
  const blob = await gh(env, `/repos/${owner}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content: b64(content), encoding: 'base64' }),
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    const baseCommit = await mainSha(env, branch);
    const base = await gh(env, `/repos/${owner}/git/commits/${baseCommit}`);
    const tree = await gh(env, `/repos/${owner}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({
        base_tree: base.tree.sha,
        tree: [{ path, mode: '100644', type: 'blob', sha: blob.sha }],
      }),
    });
    const commit = await gh(env, `/repos/${owner}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({ message, tree: tree.sha, parents: [baseCommit] }),
    });
    try {
      await gh(env, `/repos/${owner}/git/refs/heads/${branch}`, {
        method: 'PATCH',
        body: JSON.stringify({ sha: commit.sha, force: false }),
      });
      return commit.sha;
    } catch (e) {
      // Someone else moved the branch between our read and our write. The blob
      // is unchanged, so rebuilding the tree on the new head is all it takes.
      if (attempt === 2) throw e;
    }
  }
  throw new Error('commitBlob: could not advance ' + branch);
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

/** Creates or updates a single file. `sha` is REQUIRED when the file exists —
 *  GitHub rejects an update without it ("sha wasn't supplied"). */
export async function putFile(env, path, content, branch, message, sha) {
  const body = { message, content: b64(content), branch };
  if (sha) body.sha = sha;
  const res = await fetch(API + `/repos/${repo(env)}/contents/${encodeURI(path)}`, {
    method: 'PUT',
    headers: headers(env),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('put ' + path + ' -> ' + ((data && data.message) || res.status));
  return data;
}

/** Same as putFile but takes already-base64 content (images, binaries). */
export async function putBinary(env, path, base64, branch, message, sha) {
  const body = { message, content: String(base64).replace(/\s/g, ''), branch };
  if (sha) body.sha = sha;
  const res = await fetch(API + `/repos/${repo(env)}/contents/${encodeURI(path)}`, {
    method: 'PUT',
    headers: headers(env),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('put ' + path + ' -> ' + ((data && data.message) || res.status));
  return data;
}

/** Delete a file. GitHub requires the blob sha, otherwise it 404s/409s. */
export async function deleteFile(env, path, branch, message, sha) {
  return gh(env, `/repos/${repo(env)}/contents/${encodeURI(path)}`, {
    method: 'DELETE',
    body: JSON.stringify({ message, sha, branch }),
  });
}

/** List a directory. Returns [] when the path does not exist. */
export async function listDir(env, path, branch = 'main') {
  try {
    const r = await gh(
      env,
      `/repos/${repo(env)}/contents/${path}?ref=${encodeURIComponent(branch)}`
    );
    return Array.isArray(r) ? r : [];
  } catch (e) {
    if (/404|Not Found/i.test(String(e && e.message))) return [];
    throw e;
  }
}

export async function openPr(env, { title, body, head, base = 'main' }) {
  const pr = await gh(env, `/repos/${repo(env)}/pulls`, {
    method: 'POST',
    body: JSON.stringify({ title, body, head, base }),
  });
  return { number: pr.number, url: pr.html_url };
}

/**
 * Merge a pull request. Used by the content agent's auto-publish mode so a
 * generated post reaches production without a human clicking "merge".
 * Returns the GitHub merge result ({ merged, sha, message }).
 */
export async function mergePr(env, number, squash = true) {
  const r = await gh(env, `/repos/${repo(env)}/pulls/${number}/merge`, {
    method: 'PUT',
    body: JSON.stringify({
      merge_method: squash ? 'squash' : 'merge',
      commit_title: 'auto: merge AI content draft #' + number,
      commit_message: 'Merged by the nightly content scheduler.',
    }),
  });
  return r;
}

/** Best-effort cleanup of the source branch after an auto-merge. */
/**
 * The open PR whose head is `branch`, or null. The revise flow needs the PR
 * number to push an expanded draft through, and the branch name is all the
 * caller has.
 */
export async function findPrByBranch(env, branch) {
  try {
    const owner = String(repo(env)).split('/')[0];
    const list = await gh(
      env,
      `/repos/${repo(env)}/pulls?state=open&head=${encodeURIComponent(owner + ':' + branch)}`
    );
    return Array.isArray(list) && list.length ? list[0] : null;
  } catch (e) {
    return null;
  }
}

export async function deleteBranch(env, name) {
  try {
    await gh(env, `/repos/${repo(env)}/git/refs/heads/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  } catch (e) {
    // Branch may already be auto-deleted by GitHub, or the merge used a
    // different strategy. Logging only — publishing already succeeded.
    console.warn('[github] branch delete skipped: ' + ((e && e.message) || e));
  }
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
    // f.sha is required when the file already exists on main (the branch is
    // cut from main, so GitHub rejects the update otherwise).
    await putFile(env, f.path, f.content, branch, f.message || title, f.sha);
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
