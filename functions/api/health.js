/**
 * GET /api/health — deployment / wiring self-check.
 *
 * Use this immediately after deploying to confirm what is actually bound:
 *   curl https://stagelumen.pages.dev/api/health
 */

import { ok } from '../_lib/util.js';
import { hasDb, scalar } from '../_lib/db.js';
import { ensureSchema, schemaReady } from '../_lib/schema.js';
import { callAI, MODELS } from '../_lib/reception.js';
import { ghProbe } from '../_lib/github.js';

/**
 * Binding diagnostics.
 *
 * Only key NAMES are reported, never values — the repo is public and this
 * endpoint is unauthenticated. We deliberately list (a) a fixed whitelist and
 * (b) any env key whose name matches /ai/i, so that a mis-named binding
 * (`ai`, `workersAI`, `AI_BINDING`, ...) still shows up without leaking
 * unrelated secret names.
 */
const WHITELIST = [
  'AI', 'DB', 'ADMIN_TOKEN', 'GITHUB_PAT', 'RESEND_API_KEY',
  'NOTIFY_WEBHOOK', 'VECTORIZE', 'KV', 'R2', 'ASSETS',
];

function diagnose(env) {
  const bag = env || {};
  let names = [];
  try { names = Object.keys(bag); } catch (_) { names = []; }

  const present = WHITELIST.filter((k) => k in bag);
  const aiLike = names.filter((k) => /ai/i.test(k) && !WHITELIST.includes(k));

  const ai = bag.AI;
  return {
    keys_present: present,
    ai_like_keys: aiLike,
    ai: {
      present: 'AI' in bag,
      js_type: ai === null ? 'null' : Array.isArray(ai) ? 'array' : typeof ai,
      has_run: !!(ai && typeof ai.run === 'function'),
    },
    env_key_count: names.length,
    pages: {
      branch: bag.CF_PAGES_BRANCH || null,
      commit: bag.CF_PAGES_COMMIT_SHA ? String(bag.CF_PAGES_COMMIT_SHA).slice(0, 8) : null,
      environment: bag.CF_PAGES_BRANCH === 'main' ? 'production' : 'preview-or-branch',
    },
  };
}

/**
 * Which notification channels are actually wired up.
 *
 * Values are never returned: a webhook URL carries its own secret key, and
 * publishing it here would let anyone push to the group. Host names only.
 */
function notifyDiag(env) {
  const to = String(env.NOTIFY_EMAIL || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const mask = (v) => {
    const s = String(v || '').trim();
    const m = s.match(/<([^>]+)>/);
    const addr = m ? m[1] : s;
    const parts = addr.split('@');
    if (parts.length !== 2) return addr ? addr.slice(0, 2) + '***' : null;
    return parts[0].slice(0, 2) + '***@' + parts[1];
  };
  let host = null;
  if (env.NOTIFY_WEBHOOK) {
    try { host = new URL(String(env.NOTIFY_WEBHOOK)).hostname; } catch (_) { host = 'invalid-url'; }
  }
  return {
    email: {
      configured: !!env.RESEND_API_KEY && to.length > 0,
      missing: [
        ...(env.RESEND_API_KEY ? [] : ['RESEND_API_KEY']),
        ...(to.length ? [] : ['NOTIFY_EMAIL']),
      ],
      to: to.map(mask),
      from: env.NOTIFY_FROM ? mask(env.NOTIFY_FROM) : 'onboarding@resend.dev (default)',
    },
    webhook: { configured: !!env.NOTIFY_WEBHOOK, host },
    github_issue: { configured: !!env.GITHUB_PAT },
    hot_only: !!env.NOTIFY_HOT_ONLY,
    note: 'An inquiry with no working channel is stored in D1 but nobody is alerted. ' +
          'Set at least one of: RESEND_API_KEY+NOTIFY_EMAIL, NOTIFY_WEBHOOK, GITHUB_PAT.',
  };
}

export async function onRequest(context) {
  const { env, request } = context;
  let leadCount = 0;
  let schemaOk = false;

  if (hasDb(env)) {
    schemaOk = await ensureSchema(env);
    leadCount = await scalar(env, 'SELECT COUNT(*) AS c FROM leads');
  }

  // Opt-in smoke test: `?ai=1` spends a handful of tokens to prove the AI
  // binding actually answers, and surfaces the real error when it does not.
  // Off by default so plain health checks stay free.
  let smoke = null;
  try {
    if (new URL(request.url).searchParams.get('ai') === '1') {
      const r = await callAI(env, 'Reply with the single word: OK', MODELS.chat, 8);
      smoke = {
        ok: !!r.text,
        model_used: r.text ? r.model : null,
        ms: r.ms,
        sample: r.text ? String(r.text).slice(0, 40) : null,
        error: r.error || null,
        shape: r.shape || null,
        attempts: (r.attempts || []).map((a) => a.model + ': ' + a.error),
      };
    }
  } catch (e) {
    smoke = { ok: false, error: String((e && e.message) || e).slice(0, 200) };
  }

  // `?gh=1` proves the stored PAT actually authenticates. A token can be
  // present and still be a bad copy, which is exactly what went wrong once.
  let gh = null;
  try {
    if (new URL(request.url).searchParams.get('gh') === '1') {
      gh = await ghProbe(env);
    }
  } catch (e) {
    gh = { ok: false, error: String((e && e.message) || e).slice(0, 200) };
  }

  // `?notify=1` sends a real test message through email + webhook. Admin only,
  // because it costs money and wakes people up. GitHub issues are deliberately
  // excluded — a test must not litter the CRM with fake inquiries.
  let notifyTest = null;
  try {
    if (new URL(request.url).searchParams.get('notify') === '1') {
      if (!adminAuthorized(request, env)) {
        return fail(env.ADMIN_TOKEN ? 'Unauthorized (?notify=1 requires the admin token)' : 'ADMIN_TOKEN is not configured', 401);
      }
      const probe = {
        id: 'test_' + Date.now(),
        name: 'Health check',
        email: 'healthcheck@stagelumen.pages.dev',
        company: 'StageLumen self-test',
        country: '-',
        phone: '-',
        qty: '-',
        raw_text: 'This is a delivery test from /api/health?notify=1. No action needed.',
        page_url: 'https://stagelumen.pages.dev/api/health?notify=1',
      };
      const base = { intent: 'quote', urgency: 'high', score: 99, stage: 'hot' };
      const [email, webhook] = await Promise.all([
        sendEmail(env, '[TEST] StageLumen notification check', 'Delivery test — if you are reading this, email notification works.\n'),
        sendWebhook(env, probe, base),
      ]);
      notifyTest = { email, webhook, channels_ok: !!(email || webhook) };
    }
  } catch (e) {
    notifyTest = { error: String((e && e.message) || e).slice(0, 200) };
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
    notify: notifyDiag(env),
    diag: diagnose(env),
    ai_smoke: smoke,
    gh_probe: gh,
    notify_test: notifyTest,
  });
}
