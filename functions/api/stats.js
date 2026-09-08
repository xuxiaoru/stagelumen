/**
 * GET /api/stats — KPI aggregates for the leads board / dashboard (admin)
 */

import { ok, fail, handleOptions, adminAuthorized } from '../_lib/util.js';
import { all, scalar } from '../_lib/db.js';
import { ensureSchema } from '../_lib/schema.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleOptions();
  if (!adminAuthorized(request, env)) {
    return fail(env.ADMIN_TOKEN ? 'Unauthorized' : 'ADMIN_TOKEN is not configured', 401);
  }
  await ensureSchema(env);

  const days = Math.min(Math.max(parseInt(new URL(request.url).searchParams.get('days') || '30', 10) || 30, 1), 365);
  const since = new Date(Date.now() - days * 86400000)
    .toISOString().replace('T', ' ').slice(0, 19);

  const [total, inWindow, hot, spam, byStatus, byStage, byIntent, byCountry, recent, won] =
    await Promise.all([
      scalar(env, 'SELECT COUNT(*) AS c FROM leads'),
      scalar(env, 'SELECT COUNT(*) AS c FROM leads WHERE created_at > ?', [since]),
      scalar(env, "SELECT COUNT(*) AS c FROM leads WHERE stage = 'hot' AND created_at > ?", [since]),
      scalar(env, "SELECT COUNT(*) AS c FROM leads WHERE intent = 'spam' AND created_at > ?", [since]),
      all(env, 'SELECT status AS k, COUNT(*) AS v FROM leads WHERE created_at > ? GROUP BY status', [since]),
      all(env, 'SELECT stage AS k, COUNT(*) AS v FROM leads WHERE created_at > ? GROUP BY stage', [since]),
      all(env, 'SELECT intent AS k, COUNT(*) AS v FROM leads WHERE created_at > ? GROUP BY intent', [since]),
      all(env, 'SELECT country AS k, COUNT(*) AS v FROM leads WHERE created_at > ? GROUP BY country ORDER BY v DESC LIMIT 10', [since]),
      all(env, 'SELECT id, name, company, country, stage, intent, score, created_at FROM leads ORDER BY created_at DESC LIMIT 8'),
      scalar(env, "SELECT COUNT(*) AS c FROM leads WHERE status = 'won' AND created_at > ?", [since]),
    ]);

  const avgScore = await scalar(
    env,
    "SELECT AVG(score) AS c FROM leads WHERE created_at > ? AND intent != 'spam'",
    [since]
  );

  return ok({
    days,
    total,
    in_window: inWindow,
    hot,
    spam,
    won,
    conversion: inWindow > 0 ? Math.round((won / inWindow) * 1000) / 10 : 0,
    avg_score: Math.round(avgScore * 10) / 10,
    by_status: byStatus,
    by_stage: byStage,
    by_intent: byIntent,
    by_country: byCountry,
    recent,
  });
}
