/**
 * StageLumen AI — Notification layer (zero dependencies)
 *
 * All channels are OPTIONAL. Each one is skipped silently when its
 * environment variable is not configured, so the pipeline never breaks.
 *
 *   RESEND_API_KEY + NOTIFY_EMAIL  -> email via Resend
 *   NOTIFY_WEBHOOK                 -> 企业微信 / 飞书 / 钉钉 / Slack / Make / n8n
 *   GITHUB_PAT + GITHUB_REPO       -> opens a GitHub issue (zero-cost CRM fallback)
 */

function shortText(s, n) {
  const t = String(s || '');
  return t.length > n ? t.slice(0, n) + '…' : t;
}

async function postJson(url, body, headers) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch (e) {
    console.error('[notify.post] ' + (e && e.message ? e.message : String(e)));
    return false;
  }
}

// ------------------------------------------------------------------- email

function recipients(env) {
  return String(env.NOTIFY_EMAIL || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** Address is masked: this surfaces in admin diagnostics, never in a secret. */
function maskAddr(v) {
  const s = String(v || '').trim();
  const parts = s.split('@');
  if (parts.length !== 2) return s ? s.slice(0, 2) + '***' : '-';
  return parts[0].slice(0, 2) + '***@' + parts[1];
}

/**
 * Same send, but explains itself.
 *
 * Resend returns 403 with a human-readable message in two very common cases:
 * the from-domain is not verified, or the domain is unverified and the
 * recipient is not the Resend account email. A bare boolean hides both, which
 * is how a broken alert channel stays broken for weeks.
 */
export async function sendEmailVerbose(env, subject, text) {
  const to = recipients(env);
  if (!env.RESEND_API_KEY) return { ok: false, reason: 'RESEND_API_KEY is not set' };
  if (!to.length) return { ok: false, reason: 'NOTIFY_EMAIL is not set' };

  const from = env.NOTIFY_FROM || 'StageLumen AI <onboarding@resend.dev>';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + env.RESEND_API_KEY,
      },
      body: JSON.stringify({ from, to, subject: String(subject).slice(0, 200), text }),
    });
    const body = await res.text().catch(() => '');
    let parsed = null;
    try { parsed = body ? JSON.parse(body) : null; } catch (_) { /* plain text body */ }

    if (res.ok) {
      return { ok: true, status: res.status, id: parsed && parsed.id, to: to.map(maskAddr), from };
    }
    return {
      ok: false,
      status: res.status,
      reason: (parsed && (parsed.message || parsed.name)) || body.slice(0, 200) || ('HTTP ' + res.status),
      to: to.map(maskAddr),
      from,
    };
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e).slice(0, 200) };
  }
}

export async function sendEmail(env, subject, text) {
  const r = await sendEmailVerbose(env, subject, text);
  if (!r.ok) console.error('[notify.email] ' + JSON.stringify(r));
  return r.ok;
}

// ----------------------------------------------------------------- webhook

export async function sendWebhook(env, lead, base) {
  const url = env.NOTIFY_WEBHOOK;
  if (!url) return false;

  const title = '[' + base.stage.toUpperCase() + '] ' +
    (lead.company || lead.name || 'Unknown') + ' — ' + base.intent +
    ' (score ' + base.score + ')';

  const md =
    '**' + title + '**\n' +
    '- Name: ' + (lead.name || '-') + '\n' +
    '- Company: ' + (lead.company || '-') + '\n' +
    '- Country: ' + (lead.country || '-') + '\n' +
    '- Email: ' + (lead.email || '-') + '\n' +
    '- Phone: ' + (lead.phone || '-') + '\n' +
    '- Category: ' + (lead.category || '-') + '\n' +
    '- Qty: ' + (lead.qty || '-') + ' | Budget: ' + (lead.budget || '-') + '\n' +
    '- Urgency: ' + base.urgency + '\n' +
    '- Source: ' + shortText(lead.page_url, 120) + '\n' +
    '- Message: ' + shortText(lead.raw_text, 600) + '\n';

  // 企业微信机器人
  if (url.indexOf('qyapi.weixin.qq.com') !== -1) {
    return postJson(url, { msgtype: 'markdown', markdown: { content: md } });
  }
  // 钉钉机器人
  if (url.indexOf('oapi.dingtalk.com') !== -1) {
    return postJson(url, {
      msgtype: 'markdown',
      markdown: { title: shortText(title, 100), text: md },
    });
  }
  // 飞书机器人
  if (url.indexOf('open.feishu.cn') !== -1 || url.indexOf('open.larksuite.com') !== -1) {
    return postJson(url, { msg_type: 'text', content: { text: md.replace(/\*\*/g, '') } });
  }
  // 通用 webhook (Slack / Make / n8n / Zapier)
  return postJson(url, {
    text: title,
    lead,
    triage: base,
  });
}

// ------------------------------------------------------------ github issue

/**
 * Fallback CRM with zero infrastructure: every inquiry becomes a GitHub issue.
 * Useful until D1 is bound, or as a permanent audit trail.
 */
export async function createGithubIssue(env, lead, base) {
  const pat = env.GITHUB_PAT;
  const repo = env.GITHUB_REPO || 'xuxiaoru/stagelumen';
  if (!pat) return false;

  const title = '[' + base.stage.toUpperCase() + '] ' +
    (lead.company || lead.name || 'Unknown') + ' — ' + base.intent;

  const body =
    '## Inquiry ' + lead.id + '\n\n' +
    '| Field | Value |\n|---|---|\n' +
    '| Name | ' + (lead.name || '-') + ' |\n' +
    '| Company | ' + (lead.company || '-') + ' |\n' +
    '| Country | ' + (lead.country || '-') + ' |\n' +
    '| Email | ' + (lead.email || '-') + ' |\n' +
    '| Phone | ' + (lead.phone || '-') + ' |\n' +
    '| Category | ' + (lead.category || '-') + ' |\n' +
    '| Application | ' + (lead.application || '-') + ' |\n' +
    '| Qty | ' + (lead.qty || '-') + ' |\n' +
    '| Budget | ' + (lead.budget || '-') + ' |\n' +
    '| Lead time | ' + (lead.lead_time || '-') + ' |\n' +
    '| Trade terms | ' + (lead.trade_terms || '-') + ' |\n' +
    '| Intent | ' + base.intent + ' |\n' +
    '| Urgency | ' + base.urgency + ' |\n' +
    '| Score | ' + base.score + ' |\n' +
    '| Page | ' + shortText(lead.page_url, 200) + ' |\n\n' +
    '### Message\n\n' + (lead.raw_text || '_empty_') + '\n\n' +
    '### AI summary\n\n' + (lead.ai_summary || '_n/a_') + '\n\n' +
    '### Drafted reply\n\n```\n' + (lead.ai_reply || '_n/a_') + '\n```\n\n' +
    '> Auto-generated by StageLumen AI reception agent.';

  try {
    const res = await fetch('https://api.github.com/repos/' + repo + '/issues', {
      method: 'POST',
      headers: {
        authorization: 'token ' + pat,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'user-agent': 'stagelumen-ai',
      },
      body: JSON.stringify({
        title: String(title).slice(0, 200),
        body,
        labels: (env.GITHUB_ISSUE_LABELS || 'inquiry').split(',').map((s) => s.trim()).filter(Boolean),
      }),
    });
    return res.ok || res.status === 201;
  } catch (e) {
    console.error('[notify.gh] ' + (e && e.message ? e.message : String(e)));
    return false;
  }
}

/** Fire all configured channels. Never throws. */
export async function notifyAll(env, lead, base) {
  const results = { email: false, webhook: false, github: false };

  // Spam never wakes anyone up.
  if (base.intent === 'spam') return results;

  const hot = base.score >= 70 || base.urgency === 'high';
  const subject = (hot ? '[HOT] ' : '') +
    'New ' + base.intent + ' inquiry — ' + (lead.company || lead.name || 'Unknown') +
    ' (' + base.score + ')';

  const text =
    'Lead ' + lead.id + '\n' +
    'Score ' + base.score + '/100 | intent=' + base.intent + ' | urgency=' + base.urgency + '\n\n' +
    'Name:    ' + (lead.name || '-') + '\n' +
    'Company: ' + (lead.company || '-') + '\n' +
    'Country: ' + (lead.country || '-') + '\n' +
    'Email:   ' + (lead.email || '-') + '\n' +
    'Phone:   ' + (lead.phone || '-') + '\n' +
    'Product: ' + (lead.product_name || lead.category || '-') + '\n' +
    'Qty:     ' + (lead.qty || '-') + '\n\n' +
    'Message:\n' + (lead.raw_text || '-') + '\n\n' +
    'AI summary:\n' + (lead.ai_summary || '-') + '\n\n' +
    'Drafted reply:\n' + (lead.ai_reply || '-') + '\n';

  const jobs = [];
  if (hot || !env.NOTIFY_HOT_ONLY) {
    jobs.push(sendEmail(env, subject, text).then((r) => { results.email = r; }));
  }
  jobs.push(sendWebhook(env, lead, base).then((r) => { results.webhook = r; }));
  jobs.push(createGithubIssue(env, lead, base).then((r) => { results.github = r; }));

  await Promise.all(jobs.map((p) => p.catch(() => false)));
  return results;
}
