/**
 * GET    /api/lead?id=…   -> lead detail + notes (admin)
 * PATCH  /api/lead?id=…   -> update status / stage / score / note (admin)
 * DELETE /api/lead?id=…   -> hard-delete a lead + its notes (admin)
 *
 * A flat route (instead of /api/leads/[[id]]) keeps filenames free of square
 * brackets, which are awkward in the GitHub Contents API.
 */

import {
  ok, fail, handleOptions, adminAuthorized, readBody, str, uid, nowIso,
} from '../_lib/util.js';
import { one, run, updateLead, addNote, listNotes } from '../_lib/db.js';
import { ensureSchema } from '../_lib/schema.js';
import { notifyAll, sendAutoReplyVerbose } from '../_lib/notify.js';

const SELECT = `SELECT l.*, c.source AS customer_source
                FROM leads l LEFT JOIN customers c ON c.id = l.customer_id`;

const STATUSES = ['new', 'contacted', 'qualified', 'quoted', 'won', 'lost', 'spam'];
const STAGES = ['new', 'hot', 'warm', 'nurture', 'spam'];

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleOptions();

  if (!adminAuthorized(request, env)) {
    return fail(env.ADMIN_TOKEN ? 'Unauthorized' : 'ADMIN_TOKEN is not configured', 401);
  }
  await ensureSchema(env);

  const id = str(new URL(request.url).searchParams.get('id'), 64);
  if (!id) return fail('id is required', 422);

  // ---- detail ------------------------------------------------------------
  if (request.method === 'GET') {
    const lead = await one(env, SELECT + ' WHERE l.id = ?', [id]);
    if (!lead) return fail('Lead not found', 404);
    return ok({ lead, notes: await listNotes(env, id) });
  }

  // ---- update ------------------------------------------------------------
  if (request.method === 'PATCH') {
    const lead = await one(env, SELECT + ' WHERE l.id = ?', [id]);
    if (!lead) return fail('Lead not found', 404);

    const body = await readBody(request);
    const patch = {};

    // Re-send notifications. Needed when a lead arrived before any channel was
    // configured (or while the PAT was broken) and would otherwise be lost.
    let notifyResult = null;
    if (body.notify) {
      notifyResult = await notifyAll(env, lead, {
        intent: lead.intent || 'quote',
        urgency: lead.urgency || 'normal',
        score: lead.score || 0,
        stage: lead.stage || 'new',
      });
      patch.notified = (notifyResult.email ? 1 : 0) |
        (notifyResult.webhook ? 2 : 0) |
        (notifyResult.github ? 4 : 0);
    }

    // Send / re-send the acknowledgement to the customer, using whatever text
    // is currently stored in ai_reply (so an edited draft can be reviewed here
    // first). Refuses to double-send unless explicitly forced.
    let autoReplyResult = null;
    if (body.autoReply) {
      if (lead.autoreply_sent === 1 && !body.force) {
        return fail('Already acknowledged — pass force:true to send again', 409);
      }
      autoReplyResult = await sendAutoReplyVerbose(env, lead);
      patch.autoreply_sent = autoReplyResult.ok ? 1 : 2;
    }

    if (body.status) {
      const v = String(body.status);
      if (STATUSES.indexOf(v) === -1) return fail('Invalid status', 422);
      // Losing a deal without a reason poisons the data flywheel — refuse it.
      if (v === 'lost' && !str(body.lostReason, 200)) {
        return fail('lost_reason is required when marking a lead as lost', 422);
      }
      patch.status = v;
      if (v === 'lost') patch.lost_reason = str(body.lostReason, 200);
    }

    if (body.stage) {
      const v = String(body.stage);
      if (STAGES.indexOf(v) === -1) return fail('Invalid stage', 422);
      patch.stage = v;
    }

    if (body.score !== undefined) {
      const n = parseInt(body.score, 10);
      if (Number.isFinite(n)) patch.score = Math.max(0, Math.min(100, n));
    }

    const updated = await updateLead(env, id, patch);

    const note = str(body.note, 2000);
    if (note) {
      await addNote(env, {
        id: uid('nt'), lead_id: id,
        author: str(body.author, 60) || 'admin',
        note,
        created_at: nowIso(),
      });
    }

    return ok({ updated, id, patch, notify: notifyResult, auto_reply: autoReplyResult });
  }

  // ---- delete ------------------------------------------------------------
  // Hard delete, for spam and test records. Notes go with it (no FK cascade
  // guarantee in D1 without PRAGMA, so clean up explicitly).
  if (request.method === 'DELETE') {
    const exists = await one(env, 'SELECT id FROM leads WHERE id = ?', [id]);
    if (!exists) return fail('Lead not found', 404);
    await run(env, 'DELETE FROM lead_notes WHERE lead_id = ?', [id]);
    await run(env, 'DELETE FROM leads WHERE id = ?', [id]);
    return ok({ deleted: true, id });
  }

  return fail('Method not allowed', 405);
}
