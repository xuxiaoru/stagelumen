/**
 * GET /api/leads — paginated lead list / CSV export (admin)
 *
 * Auth: Authorization: Bearer <ADMIN_TOKEN>   (or ?token=… for the browser)
 * Query: status, stage, q, days, limit, offset, format=json|csv
 *
 * Two things this route used to get wrong and no longer does:
 *   1. `total` was the row count of the whole table, so filtering by status
 *      still reported "1,204 total" and the board looked broken.
 *   2. There was no export at all — the only way to work the pipeline in a
 *      spreadsheet was to open the drawer lead by lead.
 */

import { ok, fail, handleOptions, adminAuthorized } from '../_lib/util.js';
import { all, one } from '../_lib/db.js';
import { ensureSchema } from '../_lib/schema.js';

const SELECT = `SELECT l.*, c.source AS customer_source
                FROM leads l LEFT JOIN customers c ON c.id = l.customer_id`;

/** Hard ceiling on an export: someone will hit this from a phone. */
const MAX_CSV = 5000;

/**
 * Timestamps are stored to the second, so two enquiries received in the same
 * second would otherwise come back in arbitrary order — and "newest first" is
 * the one thing this list must get right. rowid is the tie-breaker.
 *
 * Built once and shared by the page query and the COUNT query, so the "shown /
 * total" line can never contradict what is actually on screen.
 * `q` searches the quote basket too — sales remembers "the RG-380 order", not
 * the email address.
 */
function buildWhere(url) {
  const status = url.searchParams.get('status') || '';
  const stage = url.searchParams.get('stage') || '';
  const q = (url.searchParams.get('q') || '').trim();
  const days = parseInt(url.searchParams.get('days') || '0', 10) || 0;

  let sql = ' WHERE 1=1';
  const args = [];

  if (status && status !== 'all') { sql += ' AND l.status = ?'; args.push(status); }
  if (stage && stage !== 'all') { sql += ' AND l.stage = ?'; args.push(stage); }
  if (days > 0) {
    const since = new Date(Date.now() - days * 86400000)
      .toISOString().replace('T', ' ').slice(0, 19);
    sql += ' AND l.created_at > ?';
    args.push(since);
  }
  if (q) {
    const like = '%' + q + '%';
    sql += ' AND (l.email LIKE ? OR l.company LIKE ? OR l.name LIKE ? OR l.raw_text LIKE ?' +
      ' OR l.sku LIKE ? OR l.product_name LIKE ? OR l.items LIKE ? OR l.country LIKE ?)';
    args.push(like, like, like, like, like, like, like, like);
  }
  return { sql, args };
}

function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  // Excel is the consumer: neutralise the classic formula-injection prefixes so
  // a message starting with "=" cannot execute when the file is opened.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

const CSV_COLUMNS = [
  ['id', 'id'],
  ['created_at', 'received'],
  ['status', 'status'],
  ['stage', 'stage'],
  ['score', 'score'],
  ['intent', 'intent'],
  ['urgency', 'urgency'],
  ['name', 'name'],
  ['email', 'email'],
  ['phone', 'phone'],
  ['company', 'company'],
  ['country', 'country'],
  ['category', 'category'],
  ['application', 'application'],
  ['qty', 'qty'],
  ['budget', 'budget'],
  ['lead_time', 'lead_time'],
  ['trade_terms', 'trade_terms'],
  ['sku', 'sku'],
  ['product_name', 'product'],
  ['lang', 'lang'],
  ['consent_at', 'consent_at'],
  ['consent_ver', 'consent_version'],
  ['attachments', 'attachments'],
  ['utm', 'utm'],
  ['page_url', 'page_url'],
  ['raw_text', 'message'],
];

function toCsv(rows) {
  const head = CSV_COLUMNS.map((c) => csvCell(c[1])).join(',');
  const body = rows.map((r) => CSV_COLUMNS.map((c) => {
    let v = r[c[0]];
    if (c[0] === 'attachments') {
      try {
        const arr = JSON.parse(v || '[]');
        v = Array.isArray(arr) ? arr.map((f) => f.name || f.key).join(' | ') : '';
      } catch (e) { v = ''; }
    }
    return csvCell(v);
  }).join(',')).join('\r\n');
  // BOM so Excel on Windows reads UTF-8 (accented company names) correctly.
  return '\uFEFF' + head + '\r\n' + body + '\r\n';
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'GET') return fail('Method not allowed', 405);

  if (!adminAuthorized(request, env)) {
    return fail(env.ADMIN_TOKEN ? 'Unauthorized' : 'ADMIN_TOKEN is not configured', 401);
  }
  await ensureSchema(env);

  const url = new URL(request.url);
  const { sql: where, args: whereArgs } = buildWhere(url);
  const format = (url.searchParams.get('format') || 'json').toLowerCase();

  // ---- CSV export --------------------------------------------------------
  if (format === 'csv') {
    const rows = await all(
      env,
      SELECT + where + ' ORDER BY l.created_at DESC, l.rowid DESC LIMIT ' + MAX_CSV,
      whereArgs
    );
    const csv = toCsv(rows || []);
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="rigeba-leads-' + stamp + '.csv"',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  }

  // ---- JSON page ---------------------------------------------------------
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 200);
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);

  const rows = await all(env, SELECT + where + ' ORDER BY l.created_at DESC, l.rowid DESC LIMIT ? OFFSET ?', whereArgs.concat([limit, offset]));
  const totalRow = await one(env, 'SELECT COUNT(*) AS c FROM leads l' + where, whereArgs);

  return ok({
    leads: rows,
    total: totalRow ? totalRow.c : rows.length,
    limit,
    offset,
  });
}
