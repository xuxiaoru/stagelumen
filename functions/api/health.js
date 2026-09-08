/**
 * GET /api/health — deployment / wiring self-check.
 *
 * Use this immediately after deploying to confirm what is actually bound:
 *   curl https://stagelumen.pages.dev/api/health
 */

import { ok } from '../_lib/util.js';
import { hasDb, scalar } from '../_lib/db.js';
import { ensureSchema, schemaReady } from '../_lib/schema.js';

export async function onRequest(context) {
  const { env } = context;
  let leadCount = 0;
  let schemaOk = false;

  if (hasDb(env)) {
    schemaOk = await ensureSchema(env);
    leadCount = await scalar(env, 'SELECT COUNT(*) AS c FROM leads');
  }

  return ok({
    service: 'stagelumen-ai',
    stage: 'P0',
    time: new Date().toISOString(),
    bindings: {
      DB: hasDb(env),
      AI: !!(env && env.AI),
      ADMIN_TOKEN: !!env.ADMIN_TOKEN,
      RESEND: !!env.RESEND_API_KEY,
      WEBHOOK: !!env.NOTIFY_WEBHOOK,
      GITHUB_FALLBACK: !!env.GITHUB_PAT,
    },
    schema_ready: schemaOk || schemaReady(),
    leads: leadCount,
    ready: hasDb(env) && !!env.ADMIN_TOKEN,
  });
}
