/**
 * GET /api/leads — paginated lead list (admin)
 *
 * Auth: Authorization: Bearer <ADMIN_TOKEN>   (or ?token=… for the browser)
 * Query: status, stage, q, limit, offset
 */

import { ok, fail, handleOptions, adminAuthorized } from '../_lib/util.js';
import { all, one } from '../_lib/db.js';
import { ensureSchema } from '../_lib/schema.js';

const SELECT = `SELECT l.*, c.source AS customer_source
                FROM leads l LEFT JOIN customers c ON c.id = l.customer_id`;

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'GET') return fail('Method not allowed', 405);

  if (!adminAuthorized(request, env)) {
    return fail(env.ADMIN_TOKEN ? 'Unauthorized' : 'ADMIN_TOKEN is not configured', 401);
  }
  await ensureSchema(env);

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || '';
  const stage = url.searchParams.get('stage') || '';
  const q = url.searchParams.get('q') || '';
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 200);
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);

  let sql = SELECT + ' WHERE 1=1';
  const args = [];

  if (status && status !== 'all') { sql += ' AND l.status = ?'; args.push(status); }
  if (stage && stage !== 'all') { sql += ' AND l.stage = ?'; args.push(stage); }
  if (q) {
    sql += ' AND (l.email LIKE ? OR l.company LIKE ? OR l.name LIKE ? OR l.raw_text LIKE ?)';
    const like = '%' + q + '%';
    args.push(like, like, like, like);
  }

  sql += ' ORDER BY l.created_at DESC LIMIT ? OFFSET ?';
  args.push(limit, offset);

  const rows = await all(env, sql, args);
  const totalRow = await one(env, 'SELECT COUNT(*) AS c FROM leads');

  return ok({
    leads: rows,
    total: totalRow ? totalRow.c : rows.length,
    limit,
    offset,
  });
}
