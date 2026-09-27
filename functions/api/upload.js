/**
 * RFQ attachments — POST /api/upload (multipart) and GET /api/upload?key=… (admin).
 *
 * Why a separate endpoint instead of one big multipart POST /api/inquiry:
 *   - the enquiry must never be lost because a 8 MB PDF was slow to upload;
 *   - the visitor sees progress and can retry one file without re-typing;
 *   - /api/inquiry stays a small, fast JSON endpoint.
 *
 * Storage is R2 (`UPLOADS` binding). Like every other integration in this
 * codebase it degrades instead of throwing: with no binding the endpoint
 * answers 501 and the form submits without attachments, telling the visitor to
 * email the drawings instead. That is deliberately better than a silent 500.
 *
 * Downloads are admin-only and streamed back with `attachment` disposition —
 * the bucket is never public, because supplier quotes and lighting plots are
 * commercially sensitive.
 */

import { ok, json, fail, handleOptions, str, uid, adminAuthorized, clientIp } from '../_lib/util.js';
import { hitRate } from '../_lib/db.js';

const MAX_BYTES = 10 * 1024 * 1024; // per file
const MAX_FILES = 5;

/**
 * Extension allow-list rather than a MIME allow-list: browsers report
 * `application/octet-stream` for half the CAD formats a lighting dealer sends,
 * so MIME alone would reject real drawings. Nothing executable is on the list.
 */
/**
 * Errors carry a machine-readable code so the form can react without parsing
 * English prose. `fail()` is not used here: its third argument is a header bag,
 * not a body — a trap that quietly turned {code:'no_storage'} into a header.
 */
function err(code, message, status) {
  return json({ ok: false, code, error: message }, status);
}

const ALLOWED_EXT = [
  'pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic',
  'dwg', 'dxf', 'skp', 'rvt', 'ies',
  'zip', 'rar', '7z',
  'xlsx', 'xls', 'csv', 'ods',
  'doc', 'docx', 'odt', 'ppt', 'pptx', 'txt', 'rtf',
];

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method === 'POST') return handleUpload(context);
  if (request.method === 'GET') return handleDownload(context);
  return fail('Method not allowed', 405);
}

function ext(name) {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

/** Strip anything that could break a header or a key. */
function safeName(name) {
  return String(name || 'file')
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120) || 'file';
}

async function handleUpload(context) {
  const { request, env } = context;
  const ip = clientIp(request);

  if (!env || !env.UPLOADS || typeof env.UPLOADS.put !== 'function') {
    return err('no_storage',
      'File upload is not enabled yet. Please email the drawings to sales20@rigelighting.com.', 501);
  }

  // 30 uploads per 10 minutes per IP is far above any honest use of this form
  // and stops the bucket being used as free file hosting.
  if (await hitRate(env, 'upload:' + ip, 30, 10)) {
    return err('rate_limited', 'Too many uploads. Please email sales20@rigelighting.com instead.', 429);
  }

  let form;
  try {
    form = await request.formData();
  } catch (e) {
    return err('bad_form', 'Could not read the upload. Please try again.', 400);
  }

  // `file` is the single-file field; repeated fields are all picked up too so a
  // future multi-select input keeps working without a server change.
  const files = [];
  for (const [, v] of form.entries()) {
    if (v && typeof v === 'object' && typeof v.arrayBuffer === 'function') files.push(v);
  }
  if (!files.length) return err('empty', 'No file received.', 422);
  if (files.length > MAX_FILES) {
    return err('too_many', 'Up to ' + MAX_FILES + ' files per enquiry.', 422);
  }

  const stored = [];
  for (const f of files) {
    const name = safeName(f.name);
    const e = ext(name);
    if (ALLOWED_EXT.indexOf(e) === -1) {
      return err('bad_type', 'Unsupported file type: ' + (e ? '.' + e : name), 422);
    }
    if (f.size > MAX_BYTES) {
      return err('too_large', '"' + name + '" is larger than 10 MB.', 413);
    }

    const now = new Date();
    const ym = now.getUTCFullYear() + '-' + String(now.getUTCMonth() + 1).padStart(2, '0');
    const key = 'uploads/' + ym + '/' + uid() + '-' + name;

    try {
      await env.UPLOADS.put(key, f.stream(), {
        httpMetadata: { contentType: f.type || 'application/octet-stream' },
        customMetadata: { name, ip: String(ip).slice(0, 60) },
      });
    } catch (err) {
      console.error('[upload] put failed: ' + ((err && err.message) || err));
      return err('storage_error', 'Upload failed. Please try again or email sales20@rigelighting.com.', 502);
    }

    stored.push({ key, name, size: f.size || 0, type: f.type || '' });
  }

  return ok({ files: stored });
}

async function handleDownload(context) {
  const { request, env } = context;
  if (!adminAuthorized(request, env)) {
    return fail(env.ADMIN_TOKEN ? 'Unauthorized' : 'ADMIN_TOKEN is not configured', 401);
  }
  if (!env || !env.UPLOADS || typeof env.UPLOADS.get !== 'function') {
    return err('no_storage', 'File storage is not configured', 501);
  }

  const key = str(new URL(request.url).searchParams.get('key'), 300);
  // Only keys this endpoint could have minted. Without this check an admin
  // token would double as a read-anything primitive over the whole bucket.
  if (key.indexOf('uploads/') !== 0 || key.indexOf('..') !== -1) {
    return err('bad_key', 'Invalid key', 422);
  }

  const obj = await env.UPLOADS.get(key);
  if (!obj) return fail('File not found', 404);

  const name = safeName((obj.customMetadata && obj.customMetadata.name) || key.split('/').pop());
  const type = (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream';
  return new Response(obj.body, {
    headers: {
      'content-type': type,
      'content-length': String(obj.size || ''),
      'content-disposition': 'attachment; filename="' + name.replace(/"/g, '') + '"',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'access-control-allow-origin': '*',
    },
  });
}
