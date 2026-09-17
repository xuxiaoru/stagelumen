/**
 * /api/admin-chats — AI conversation archive (admin only)
 *
 *   GET    /api/admin-chats              -> paginated sessions
 *   GET    /api/admin-chats?id=cs_xxx    -> one session + full transcript
 *   PATCH  /api/admin-chats  {id,…}      -> take over / close / annotate
 *   DELETE /api/admin-chats?days=180     -> hard-delete old threads (min 30)
 *
 * This exists because the visitor-facing assistant is deliberately single-shot
 * and unable to close a deal on its own. Every thread it could not answer is
 * filed here so a human can pick it up — and so the unanswered questions can
 * be mined for KB entries later.
 *
 * Auth: Authorization: Bearer <ADMIN_TOKEN>  (or ?token=… for the browser)
 */

import { ok, fail, handleOptions, readBody, str, adminAuthorized } from '../_lib/util.js';
import {
  listChatSessions, countChatSessions, getChatSession, listChatMessages,
  updateChatSession, purgeChatSessions, scalar,
} from '../_lib/db.js';
import { ensureSchema } from '../_lib/schema.js';

const STATUSES = ['open', 'claimed', 'closed', 'archived'];

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleOptions();

  if (!adminAuthorized(request, env)) {
    return fail(env.ADMIN_TOKEN ? 'Unauthorized' : 'ADMIN_TOKEN is not configured', 401);
  }
  await ensureSchema(env);

  if (request.method === 'GET') return get_(context);
  if (request.method === 'PATCH') return patch_(context);
  if (request.method === 'DELETE') return del_(context);
  return fail('Method not allowed', 405);
}

async function get_(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const id = str(url.searchParams.get('id'), 64);

  if (id) {
    const session = await getChatSession(env, id);
    if (!session) return fail('Conversation not found', 404);
    const messages = await listChatMessages(env, id, 300);
    return ok({ session, messages });
  }

  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 200);
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);
  const status = str(url.searchParams.get('status'), 16) || 'all';
  const q = str(url.searchParams.get('q'), 80);

  const sessions = await listChatSessions(env, { status, q, limit, offset });
  const total = await countChatSessions(env, status);

  // Headline numbers for the board: how much is waiting on us.
  const open = await countChatSessions(env, 'open');
  const claimed = await countChatSessions(env, 'claimed');
  const withEmail = await scalar(
    env,
    "SELECT COUNT(*) AS c FROM chat_sessions WHERE email IS NOT NULL AND email != ''"
  );
  const cold = await scalar(
    env,
    "SELECT COUNT(*) AS c FROM chat_sessions WHERE status = 'open' AND intent IN ('quote','oem','sample')"
  );

  return ok({ sessions, total, limit, offset, counts: { open, claimed, withEmail, hot: cold } });
}

async function patch_(context) {
  const { request, env } = context;
  let body;
  try {
    body = await readBody(request);
  } catch (e) {
    return fail('Invalid JSON body', 400);
  }

  const id = str(body.id, 64);
  if (!id) return fail('id is required', 422);

  const patch = {};
  const status = str(body.status, 16).toLowerCase();
  if (status) {
    if (STATUSES.indexOf(status) === -1) return fail('Unknown status: ' + status, 422);
    patch.status = status;
  }
  if (body.handled_by !== undefined) patch.handled_by = str(body.handled_by, 80);
  if (body.note !== undefined) patch.note = str(body.note, 2000);
  if (body.stage !== undefined) patch.stage = str(body.stage, 24);

  if (!Object.keys(patch).length) return fail('Nothing to update', 422);

  const updated = await updateChatSession(env, id, patch);
  // run() swallows SQL errors and returns false, so a 200 here is not proof.
  if (!updated) return fail('Update failed — check the Functions log for the SQL error.', 500);

  return ok({ id, patch });
}

async function del_(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const days = Math.max(parseInt(url.searchParams.get('days') || '180', 10) || 180, 30);

  const deleted = await purgeChatSessions(env, days);
  return ok({ deleted, days });
}
