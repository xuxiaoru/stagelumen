/**
 * StageLumen AI — D1 access layer (zero dependencies)
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
       sku, product_name, category, application, qty, budget, lead_time, trade_terms,
       raw_text, lang, intent, urgency, score, stage,
       ai_summary, ai_reply, status, page_url, referrer, utm, ip, ua, created_at, updated_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      lead.id, lead.customer_id, lead.name, lead.email, lead.company,
      lead.country, lead.phone, lead.sku, lead.product_name, lead.category,
      lead.application, lead.qty, lead.budget, lead.lead_time, lead.trade_terms,
      lead.raw_text, lead.lang, lead.intent, lead.urgency, lead.score, lead.stage,
      lead.ai_summary, lead.ai_reply, lead.status, lead.page_url, lead.referrer,
      lead.utm, lead.ip, lead.ua, lead.created_at, lead.updated_at,
    ]
  );
}

export async function updateLead(env, id, patch) {
  if (!hasDb(env)) return false;
  const allowed = ['status', 'stage', 'intent', 'urgency', 'score', 'lost_reason', 'ai_reply', 'ai_summary', 'notified'];
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

/** Simple IP throttle backed by D1 — no extra binding required. */
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
