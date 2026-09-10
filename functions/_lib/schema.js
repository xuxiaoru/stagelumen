/**
 * StageLumen AI — self-healing schema
 *
 * Runs a cheap existence check on each request. If the tables are missing
 * (e.g. right after binding D1), they are created automatically.
 * This removes the "remember to run wrangler d1 migrations" step entirely.
 */

import { run, one } from './db.js';

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS customers (
     id TEXT PRIMARY KEY,
     email TEXT UNIQUE NOT NULL,
     name TEXT, company TEXT, country TEXT, phone TEXT,
     source TEXT, tags TEXT,
     created_at TEXT, updated_at TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS leads (
     id TEXT PRIMARY KEY,
     customer_id TEXT,
     name TEXT, email TEXT, company TEXT, country TEXT, phone TEXT,
     sku TEXT, product_name TEXT, category TEXT, application TEXT,
     qty TEXT, budget TEXT, lead_time TEXT, trade_terms TEXT,
     raw_text TEXT, lang TEXT,
     intent TEXT, urgency TEXT, score INTEGER DEFAULT 0, stage TEXT,
     ai_summary TEXT, ai_reply TEXT,
     status TEXT DEFAULT 'new', lost_reason TEXT,
     page_url TEXT, referrer TEXT, utm TEXT, ip TEXT, ua TEXT,
     notified INTEGER DEFAULT 0,
     created_at TEXT, updated_at TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS lead_notes (
     id TEXT PRIMARY KEY, lead_id TEXT, author TEXT, note TEXT, created_at TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS agent_runs (
     id TEXT PRIMARY KEY, agent TEXT, model TEXT, lead_id TEXT,
     ms INTEGER, ok INTEGER DEFAULT 1, error TEXT, created_at TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS rate_limits (
     k TEXT PRIMARY KEY, n INTEGER DEFAULT 0, window_start TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_leads_stage   ON leads(stage)`,
  `CREATE INDEX IF NOT EXISTS idx_leads_email   ON leads(email)`,
  `CREATE INDEX IF NOT EXISTS idx_leads_status  ON leads(status)`,
  `CREATE INDEX IF NOT EXISTS idx_notes_lead    ON lead_notes(lead_id)`,
];

let ready = false;

export async function ensureSchema(env) {
  if (ready) return true;
  if (!env || !env.DB) return false;
  try {
    const row = await one(
      env,
      "SELECT name FROM sqlite_master WHERE type='table' AND name='leads'"
    );
    if (row) {
      ready = true;
      return true;
    }
    for (const sql of STATEMENTS) await run(env, sql);
    ready = true;
    console.log('[schema] tables created');
    return true;
  } catch (e) {
    console.error('[schema] ' + (e && e.message ? e.message : String(e)));
    return false;
  }
}

/** Exposed so /api/health can report schema state. */
export function schemaReady() {
  return ready;
}
