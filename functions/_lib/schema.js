/**
 * StageLumen AI — self-healing schema
 *
 * Runs a cheap existence check on each request. If the tables are missing
 * (e.g. right after binding D1), they are created automatically.
 * This removes the "remember to run wrangler d1 migrations" step entirely.
 */

import { run, all } from './db.js';

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
     autoreply_sent INTEGER DEFAULT 0,
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

  // ---- analytics: first-party, cookieless traffic + event tracking --------
  `CREATE TABLE IF NOT EXISTS analytics (
     id TEXT PRIMARY KEY,
     ts TEXT,
     type TEXT,            -- 'pageview' | 'event'
     name TEXT,            -- event name: product_view, rfq_click, cta_click, search…
     path TEXT,            -- page path
     model TEXT,           -- product model if relevant
     visitor TEXT,         -- first-party visitor id (no PII)
     ref TEXT,             -- referrer
     country TEXT,         -- edge country
     meta TEXT             -- JSON extras (utm, element, …)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_an_ts     ON analytics(ts)`,
  `CREATE INDEX IF NOT EXISTS idx_an_type   ON analytics(type)`,
  `CREATE INDEX IF NOT EXISTS idx_an_path   ON analytics(path)`,
  `CREATE INDEX IF NOT EXISTS idx_an_model  ON analytics(model)`,
  `CREATE INDEX IF NOT EXISTS idx_an_vis    ON analytics(visitor)`,
];

/**
 * Every table the DDL above is expected to create, derived from STATEMENTS so
 * that adding a table in a future deploy keeps the readiness check in sync
 * automatically. Used to detect a partially-created schema.
 */
const REQUIRED_TABLES = STATEMENTS
  .map((s) => {
    const m = s.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+"?([A-Za-z_]\w*)"?/i);
    return m ? m[1] : null;
  })
  .filter(Boolean);

let ready = false;
let colsChecked = false;

/**
 * Additive column migration.
 *
 * CREATE TABLE IF NOT EXISTS cannot add a column to a table that already
 * exists, so every deploy that introduces a field must ship an explicit
 * ALTER here or the INSERT silently starts failing in production.
 * SQLite ALTER is O(1) and idempotent-safe because we check against PRAGMA.
 */
const COLUMN_MIGRATIONS = [
  { column: 'autoreply_sent', ddl: 'ALTER TABLE leads ADD COLUMN autoreply_sent INTEGER DEFAULT 0' },
  { column: 'product_category', ddl: 'ALTER TABLE leads ADD COLUMN product_category TEXT' },
  { column: 'product_image', ddl: 'ALTER TABLE leads ADD COLUMN product_image TEXT' },
];

async function ensureColumns(env) {
  if (colsChecked) return true;
  try {
    const cols = await all(env, 'PRAGMA table_info(leads)');
    const names = (cols || []).map((c) => c.name);
    for (const m of COLUMN_MIGRATIONS) {
      if (names.indexOf(m.column) === -1) {
        await run(env, m.ddl);
        console.log('[schema] added column leads.' + m.column);
      }
    }
    colsChecked = true;
    return true;
  } catch (e) {
    console.error('[schema.columns] ' + (e && e.message ? e.message : String(e)));
    return false;
  }
}

export async function ensureSchema(env) {
  if (ready) return true;
  if (!env || !env.DB) return false;
  try {
    // Never short-circuit on a single table: an earlier version returned early
    // as soon as `leads` existed, which silently skipped every table added in a
    // later deploy (rate_limits, analytics). Ask which of our tables are
    // actually missing, and only run the DDL when something is absent.
    const existing = await all(env, "SELECT name FROM sqlite_master WHERE type='table'");
    const have = {};
    for (const r of (existing || [])) have[r.name] = true;
    const missing = REQUIRED_TABLES.filter((t) => !have[t]);
    if (missing.length) {
      for (const sql of STATEMENTS) await run(env, sql);
      console.log('[schema] created missing tables: ' + missing.join(', '));
    }
    ready = true;
    await ensureColumns(env);
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
