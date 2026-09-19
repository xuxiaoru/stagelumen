/**
 * RiGeBa Lighting AI — D1 access layer (zero dependencies)
 *
 * Design rule: EVERY function here degrades gracefully.
 * If the D1 binding is missing (not yet configured in the Cloudflare
 * dashboard) we return null / false instead of throwing, so the public
 * site never breaks because the database isn't wired up yet.
 */

export function hasDb(env) {
  return !!(env && env.DB && typeof env.DB.prepare === 'function');
}

async function safe(stmtPromise) {
  try {
    return await stmtPromise;
  } catch (e) {
    console.error('[db] ' + (e && e.message ? e.message : String(e)));
    return null;
  }
}

/** Run a statement, return success boolean. */
export async function run(env, sql, args = []) {
  if (!hasDb(env)) return false;
  try {
    const stmt = env.DB.prepare(sql);
    const bound = args.length ? stmt.bind.apply(stmt, args) : stmt;
    await bound.run();
    return true;
  } catch (e) {
    console.error('[db.run] ' + (e && e.message ? e.message : String(e)));
    return false;
  }
}

/** Query many rows. Returns [] when no DB or on error. */
export async function all(env, sql, args = []) {
  if (!hasDb(env)) return [];
  const res = await safe((() => {
    const stmt = env.DB.prepare(sql);
    const bound = args.length ? stmt.bind.apply(stmt, args) : stmt;
    return bound.all();
  })());
  return res && Array.isArray(res.results) ? res.results : [];
}

/** Query a single row. Returns null when not found. */
export async function one(env, sql, args = []) {
  if (!hasDb(env)) return null;
  const res = await safe((() => {
    const stmt = env.DB.prepare(sql);
    const bound = args.length ? stmt.bind.apply(stmt, args) : stmt;
    return bound.first();
  })());
  return res || null;
}

/** Scalar helper, e.g. COUNT(*). */
export async function scalar(env, sql, args = [], fallback = 0) {
  const row = await one(env, sql, args);
  if (!row) return fallback;
  const k = Object.keys(row)[0];
  const v = row[k];
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// ---------------------------------------------------------------- customers

export async function upsertCustomer(env, fields) {
  if (!hasDb(env)) return null;
  const email = String(fields.email || '').toLowerCase().trim();
  if (!email) return null;

  const existing = await one(env, 'SELECT id FROM customers WHERE email = ?', [email]);
  const id = existing ? existing.id : fields.id;

  if (existing) {
    await run(
      env,
      `UPDATE customers SET
         name      = COALESCE(NULLIF(?, ''), name),
         company   = COALESCE(NULLIF(?, ''), company),
         country   = COALESCE(NULLIF(?, ''), country),
         phone     = COALESCE(NULLIF(?, ''), phone),
         updated_at = ?
       WHERE id = ?`,
      [fields.name || '', fields.company || '', fields.country || '', fields.phone || '', fields.updated_at, existing.id]
    );
    return existing.id;
  }

  await run(
    env,
    `INSERT OR IGNORE INTO customers
       (id, email, name, company, country, phone, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, email, fields.name || '', fields.company || '',
      fields.country || '', fields.phone || '', fields.source || 'website',
      fields.created_at, fields.updated_at,
    ]
  );
  return id;
}

// -------------------------------------------------------------------- leads

export async function insertLead(env, lead) {
  if (!hasDb(env)) return false;
  return run(
    env,
    `INSERT INTO leads (
       id, customer_id, name, email, company, country, phone,
       sku, product_name, product_category, product_image, items, category, application, qty, budget, lead_time, trade_terms,
       raw_text, lang, intent, urgency, score, stage,
       ai_summary, ai_reply, status, page_url, referrer, utm, ip, ua, created_at, updated_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      lead.id, lead.customer_id, lead.name, lead.email, lead.company,
      lead.country, lead.phone, lead.sku, lead.product_name, lead.product_category, lead.product_image,
      lead.items || '', lead.category,
      lead.application, lead.qty, lead.budget, lead.lead_time, lead.trade_terms,
      lead.raw_text, lead.lang, lead.intent, lead.urgency, lead.score, lead.stage,
      lead.ai_summary, lead.ai_reply, lead.status, lead.page_url, lead.referrer,
      lead.utm, lead.ip, lead.ua, lead.created_at, lead.updated_at,
    ]
  );
}

export async function updateLead(env, id, patch) {
  if (!hasDb(env)) return false;
  const allowed = ['status', 'stage', 'intent', 'urgency', 'score', 'lost_reason',
    'ai_reply', 'ai_summary', 'notified', 'autoreply_sent'];
  const keys = Object.keys(patch).filter((k) => allowed.indexOf(k) !== -1);
  if (!keys.length) return false;
  const sets = keys.map((k) => k + ' = ?').join(', ');
  const args = keys.map((k) => patch[k]);
  args.push(now());
  args.push(id);
  return run(env, 'UPDATE leads SET ' + sets + ', updated_at = ? WHERE id = ?', args);
}

function now() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// --------------------------------------------------------------- agent runs

export async function logAgentRun(env, run_) {
  if (!hasDb(env)) return false;
  return run(
    env,
    `INSERT INTO agent_runs (id, agent, model, lead_id, ms, ok, error, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      run_.id, run_.agent, run_.model, run_.lead_id,
      run_.ms, run_.ok ? 1 : 0, run_.error || '', now(),
    ]
  );
}

// -------------------------------------------------------------- analytics

export async function insertEvent(env, ev) {
  if (!hasDb(env)) return false;
  const id = ev.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
  return run(
    env,
    `INSERT INTO analytics (id, ts, type, name, path, model, visitor, ref, country, meta)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      ev.ts || now(),
      ev.type || 'event',
      ev.name || '',
      ev.path || '',
      ev.model || '',
      ev.visitor || '',
      ev.ref || '',
      ev.country || '',
      ev.meta ? JSON.stringify(ev.meta) : '',
    ]
  );
}

export async function recentEvents(env, type, since, limit) {
  if (!hasDb(env)) return [];
  const args = [since];
  let sql = "SELECT name, model, path, COUNT(*) AS v FROM analytics WHERE ts > ?";
  if (type) { sql += ' AND type = ?'; args.push(type); }
  sql += ' GROUP BY name, model, path ORDER BY v DESC LIMIT ' + (limit || 10);
  return all(env, sql, args);
}

/**
 * Generic sliding counter for any keyed action (chat, content generation…).
 *
 * Exists because rateLimited() counts rows in `leads` by IP, which only works
 * for the inquiry endpoint. Reusing it for other routes silently returns 0
 * and throttles nothing.
 *
 * Fails open on purpose: a broken counter must never block a real customer.
 */
export async function hitRate(env, key, limit = 20, windowMinutes = 10) {
  if (!hasDb(env)) return false;
  const cutoff = new Date(Date.now() - windowMinutes * 60000)
    .toISOString().replace('T', ' ').slice(0, 19);
  try {
    const row = await one(env, 'SELECT n, window_start FROM rate_limits WHERE k = ?', [key]);
    if (!row || String(row.window_start || '') < cutoff) {
      await run(
        env,
        `INSERT INTO rate_limits (k, n, window_start) VALUES (?, 1, ?)
         ON CONFLICT(k) DO UPDATE SET n = 1, window_start = excluded.window_start`,
        [key, now()]
      );
      return false;
    }
    const n = Number(row.n || 0) + 1;
    await run(env, 'UPDATE rate_limits SET n = ? WHERE k = ?', [n, key]);
    return n > limit;
  } catch (e) {
    return false;
  }
}

// ------------------------------------------------------------------- notes

export async function addNote(env, note) {
  if (!hasDb(env)) return false;
  return run(
    env,
    'INSERT INTO lead_notes (id, lead_id, author, note, created_at) VALUES (?,?,?,?,?)',
    [note.id, note.lead_id, note.author, note.note, now()]
  );
}

export async function listNotes(env, leadId) {
  return all(env, 'SELECT * FROM lead_notes WHERE lead_id = ? ORDER BY created_at DESC', [leadId]);
}

// ------------------------------------------------------------ rate limiting

/**
 * Simple IP throttle backed by D1 — no extra binding required.
 *
 * Note: this counts rows in `leads`. It therefore only throttles the inquiry
 * endpoint; every other route must use hitRate() above.
 */
export async function rateLimited(env, ip, limit = 8, windowMinutes = 10) {
  if (!hasDb(env)) return false;
  const cutoff = new Date(Date.now() - windowMinutes * 60000)
    .toISOString().replace('T', ' ').slice(0, 19);
  const n = await scalar(
    env,
    'SELECT COUNT(*) AS c FROM leads WHERE ip = ? AND created_at > ?',
    [ip, cutoff]
  );
  return n >= limit;
}

// ------------------------------------------------------------ AI chat log

/**
 * Create/refresh a chat session.
 *
 * Client-supplied ids are accepted on purpose — the browser keeps one id for
 * the whole visit so a reload does not fork the transcript — but the caller
 * validates the shape first, and a malformed id would simply insert a new row
 * rather than corrupt an existing one.
 */
export async function upsertChatSession(env, s) {
  if (!hasDb(env)) return false;
  return run(
    env,
    `INSERT INTO chat_sessions
       (id, visitor, lang, page_url, referrer, country, ip, ua, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
    [
      s.id, s.visitor || '', s.lang || '', s.page_url || '', s.referrer || '',
      s.country || '', s.ip || '', s.ua || '', now(), now(),
    ]
  );
}

export async function updateChatSession(env, id, patch) {
  if (!hasDb(env)) return false;
  const allowed = ['email', 'intent', 'urgency', 'score', 'stage', 'lead_id',
    'status', 'note', 'handled_by', 'msg_count', 'model_hit', 'visitor', 'lang'];
  const keys = Object.keys(patch).filter((k) => allowed.indexOf(k) !== -1);
  if (!keys.length) return false;
  const args = keys.map((k) => patch[k]);
  args.push(now());
  args.push(id);
  return run(
    env,
    'UPDATE chat_sessions SET ' + keys.map((k) => k + ' = ?').join(', ') + ', updated_at = ? WHERE id = ?',
    args
  );
}

/**
 * Second-precision timestamps are enough for leads and events, but a whole
 * chat turn usually completes inside one second — several rows collapse onto
 * the same value and the transcript then reads in whatever order SQLite
 * happens to return. Messages therefore carry milliseconds.
 */
function nowMs() {
  return new Date().toISOString().replace('T', ' ').slice(0, 23);
}

export async function insertChatMessage(env, m) {
  if (!hasDb(env)) return false;
  return run(
    env,
    `INSERT INTO chat_messages
       (id, session_id, role, content, model, degraded, sources, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      m.id, m.session_id, m.role, m.content || '', m.model || '',
      m.degraded ? 1 : 0, m.sources ? JSON.stringify(m.sources) : '', nowMs(),
    ]
  );
}

export async function getChatSession(env, id) {
  if (!hasDb(env)) return null;
  return one(env, 'SELECT * FROM chat_sessions WHERE id = ?', [id]);
}

export async function listChatSessions(env, opts = {}) {
  if (!hasDb(env)) return [];
  // `preview` is the buyer's opening question. Showing it in the list is the
  // difference between a queue you can triage at a glance and a table of ids.
  let sql =
    'SELECT s.*, ' +
    '(SELECT m.content FROM chat_messages m WHERE m.session_id = s.id ' +
    " AND m.role = 'visitor' ORDER BY m.created_at ASC, m.rowid ASC LIMIT 1) AS preview " +
    'FROM chat_sessions s WHERE 1=1';
  const args = [];

  if (opts.status && opts.status !== 'all') { sql += ' AND s.status = ?'; args.push(opts.status); }
  if (opts.q) {
    // Searching the transcript, not just the metadata: what a human wants to
    // find is the question they remember, not the id we assigned it.
    sql += ' AND EXISTS (SELECT 1 FROM chat_messages m WHERE m.session_id = s.id AND lower(m.content) LIKE ?)';
    args.push('%' + String(opts.q).toLowerCase() + '%');
  }

  sql += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
  args.push(opts.limit || 50, opts.offset || 0);
  return all(env, sql, args);
}

export async function listChatMessages(env, sessionId, limit = 200) {
  if (!hasDb(env)) return [];
  // rowid is the tie-breaker: two rows written in the same millisecond must
  // still come back in the order they were written or the transcript reads
  // like two people talking over each other.
  return all(
    env,
    'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC LIMIT ' + limit,
    [sessionId]
  );
}

export async function countChatSessions(env, status) {
  if (!hasDb(env)) return 0;
  const args = [];
  let sql = 'SELECT COUNT(*) AS c FROM chat_sessions';
  if (status && status !== 'all') { sql += ' WHERE status = ?'; args.push(status); }
  return scalar(env, sql, args);
}

/**
 * Retention control. Returns how many sessions were deleted.
 *
 * Rows past their retention window are genuinely gone rather than flagged:
 * the privacy policy promises deletion, and a soft flag still leaves the text
 * readable in the UI.
 */
export async function purgeChatSessions(env, days) {
  if (!hasDb(env)) return 0;
  const cutoff = new Date(Date.now() - days * 86400000)
    .toISOString().replace('T', ' ').slice(0, 19);
  const n = await scalar(env, 'SELECT COUNT(*) AS c FROM chat_sessions WHERE created_at < ?', [cutoff]);
  await run(
    env,
    'DELETE FROM chat_messages WHERE session_id IN (SELECT id FROM chat_sessions WHERE created_at < ?)',
    [cutoff]
  );
  await run(env, 'DELETE FROM chat_sessions WHERE created_at < ?', [cutoff]);
  return n;
}
