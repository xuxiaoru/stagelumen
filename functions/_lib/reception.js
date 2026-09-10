/**
 * StageLumen AI — Reception Agent
 *
 * Two-stage design:
 *   1. A deterministic rule engine ALWAYS runs (zero cost, never fails).
 *   2. Workers AI (if the AI binding exists) refines the result.
 *
 * This means the inquiry pipeline works on day one with no AI key at all,
 * and gets smarter the moment `AI` is bound in the dashboard.
 */

const MODEL_LIGHT = '@cf/meta/llama-3.1-8b-instruct';
const MODEL_MID = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

const PATTERNS = {
  spam: ['casino', 'viagra', 'seo service', 'backlink', 'guest post', 'bitcoin',
         'crypto investment', 'payday loan', 'porn', 'weight loss', 'followers',
         'buy traffic', ' instagram ', 'gambling'],
  urgent: ['urgent', 'asap', 'as soon as possible', 'immediately', 'this week',
           'rush', 'deadline', '急需', '尽快', '马上', '紧急', '加急', '很急'],
  price: ['price', 'pricing', 'quote', 'quotation', 'cost', 'how much', 'c&f', 'fob',
          '价格', '报价', '多少钱', '单价', '报价单', '成本'],
  oem: ['oem', 'odm', 'private label', 'customized', 'custom logo', 'own brand',
        '定制', '贴牌', '丝印', 'logo', '开模'],
  sample: ['sample', 'trial order', 'test unit', '样品', '试样', '样品单'],
  aftersales: ['warranty', 'repair', 'broken', 'faulty', 'defective', 'not working',
               'spare part', '售后', '维修', '坏了', '故障', '配件'],
  catalog: ['catalog', 'catalogue', 'brochure', 'spec sheet', 'datasheet', 'pdf',
            '产品册', '目录', '规格书', '参数表'],
};

const CJK_RE = /[\u4e00-\u9fff]/;

function countHits(text, words) {
  let n = 0;
  for (const w of words) if (text.indexOf(w) !== -1) n++;
  return n;
}

function detectLang(text) {
  if (CJK_RE.test(text)) return 'zh';
  return 'en';
}

/** Quantity bucket -> numeric midpoint, used for scoring only. */
function qtyWeight(qtyLabel) {
  const q = String(qtyLabel || '').toLowerCase();
  if (/1000\+/.test(q)) return 1000;
  if (/200\s*[–-]\s*1000/.test(q)) return 400;
  if (/50\s*[–-]\s*200/.test(q)) return 100;
  if (/10\s*[–-]\s*50/.test(q)) return 25;
  if (/1\s*[–-]\s*10/.test(q)) return 5;
  return numFromQty(q);
}

/**
 * Fallback for free-typed quantities: "500 units", "1,200 pcs", "300".
 * Returns 0 when nothing numeric is present.
 */
function numFromQty(s) {
  const m = String(s || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  if (!m) return 0;
  const n = parseFloat(m[0]);
  return isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/**
 * Pull an explicit quantity out of free text, e.g. "need 300pcs beam 230W".
 * Requires a count unit right after the number so specs like "230W" are not
 * mistaken for a quantity.
 */
function qtyFromText(text) {
  const m = String(text || '').toLowerCase().replace(/,/g, '')
    .match(/(\d+(?:\.\d+)?)\s*(?:pcs|pc|pieces|piece|units|unit|sets|set)\b/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  return isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function budgetWeight(budgetLabel) {
  const b = String(budgetLabel || '').toLowerCase();
  if (/200,000\+/.test(b)) return 200000;
  if (/50,000\s*[–-]\s*200,000/.test(b)) return 100000;
  if (/10,000\s*[–-]\s*50,000/.test(b)) return 25000;
  if (/2,000\s*[–-]\s*10,000/.test(b)) return 5000;
  if (/under\s*\$?2,000/.test(b)) return 1000;
  return 0;
}

/**
 * Deterministic triage. Always available.
 */
export function triage(lead) {
  const text = [
    lead.raw_text, lead.category, lead.application,
    lead.product_name, lead.sku,
  ].join(' ').toLowerCase();

  const hits = {};
  for (const key of Object.keys(PATTERNS)) hits[key] = countHits(text, PATTERNS[key]);

  // --- quantity -----------------------------------------------------------
  // Dropdown bucket first; then free-typed qty; then "300pcs" inside the message.
  const qw = qtyWeight(lead.qty) || qtyFromText(lead.raw_text);

  // --- intent -------------------------------------------------------------
  let intent = 'general';
  if (hits.spam > 0) intent = 'spam';
  else if (hits.aftersales > 0) intent = 'aftersales';
  else if (hits.oem > 0) intent = 'oem';
  else if (hits.sample > 0) intent = 'sample';
  else if (hits.catalog > 0 && hits.price === 0) intent = 'catalog';
  else if (hits.price > 0) intent = 'quote';
  else if (qw > 0) intent = 'quote';

  // --- urgency ------------------------------------------------------------
  let urgency = 'normal';
  const leadTime = String(lead.lead_time || '').toLowerCase();
  if (hits.urgent > 0 || /urgent|≤7/.test(leadTime)) urgency = 'high';
  else if (/flexible|30\+/.test(leadTime)) urgency = 'low';

  // --- score --------------------------------------------------------------
  let score = 30;
  if (!isFreeMailLocal(lead.email)) score += 22;      // business email
  if (lead.company) score += 8;
  if (lead.phone) score += 8;
  if (qw >= 1000) score += 20; else if (qw >= 400) score += 15;
  else if (qw >= 100) score += 10; else if (qw >= 25) score += 5;
  const bw = budgetWeight(lead.budget);
  if (bw >= 100000) score += 15; else if (bw >= 25000) score += 10;
  else if (bw >= 5000) score += 5;
  if (urgency === 'high') score += 10;
  if (intent === 'quote') score += 5;
  if (intent === 'oem') score += 5;
  if (intent === 'aftersales') score -= 5;
  if (hits.spam > 0) score = Math.min(score, 5);
  score = Math.max(0, Math.min(100, score));

  // --- stage --------------------------------------------------------------
  let stage = 'new';
  if (intent === 'spam') stage = 'spam';
  else if (score >= 70) stage = 'hot';
  else if (score >= 45) stage = 'warm';
  else stage = 'nurture';

  return {
    intent,
    urgency,
    score,
    stage,
    lang: detectLang(lead.raw_text || ''),
    signals: hits,
  };
}

function isFreeMailLocal(email) {
  const d = String(email || '').toLowerCase().split('@')[1] || '';
  const free = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com',
    'aol.com', 'proton.me', 'protonmail.com', 'mail.com', 'gmx.com', 'yandex.com',
    'zoho.com', 'live.com', 'msn.com', '163.com', 'qq.com', '126.com', 'sina.com',
    'foxmail.com', 'yeah.net'];
  return free.indexOf(d) !== -1;
}

// ---------------------------------------------------------------- AI refine

/**
 * Workers AI text-generation responses are not shaped consistently across
 * model families: some return {response}, some wrap it in {result:{response}},
 * some use {result:{text}}. Returning a non-string here used to silently
 * downgrade every reply to the rules fallback.
 */
export function pickText(res) {
  if (!res) return null;
  if (typeof res.response === 'string') return res.response;
  const r = res.result;
  if (typeof r === 'string') return r;
  if (r && typeof r.response === 'string') return r.response;
  if (r && typeof r.text === 'string') return r.text;
  return null;
}

export async function callAI(env, prompt, model, maxTokens) {
  if (!env || !env.AI || typeof env.AI.run !== 'function') {
    return { text: null, model, ms: 0, error: 'no-binding' };
  }
  const t0 = Date.now();
  try {
    const res = await env.AI.run(model, {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens || 500,
      temperature: 0.3,
    });
    const text = pickText(res);
    if (text == null) {
      // Do not leak the raw payload to callers; the shape is enough to debug.
      const shape = res && typeof res === 'object' ? Object.keys(res).slice(0, 8) : typeof res;
      console.error('[ai] unexpected payload shape: ' + JSON.stringify(shape));
      return { text: null, model, ms: Date.now() - t0, error: 'unexpected-shape', shape };
    }
    return { text, model, ms: Date.now() - t0 };
  } catch (e) {
    const msg = String((e && e.message) || e || 'unknown');
    console.error('[ai] ' + msg);
    return { text: null, model, ms: Date.now() - t0, error: msg.slice(0, 200) };
  }
}

function extractJson(text) {
  if (!text) return null;
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s === -1 || e === -1 || e <= s) return null;
  try {
    return JSON.parse(text.slice(s, e + 1));
  } catch (err) {
    return null;
  }
}

/**
 * Ask the model for a structured refinement + a drafted reply.
 * Returns null when AI is unavailable — caller falls back to rules.
 */
export async function refineWithAI(env, lead, base) {
  const model = base.score >= 60 || base.intent === 'oem' ? MODEL_MID : MODEL_LIGHT;

  const prompt =
    'You are a senior export sales engineer at StageLumen (RIGE Lighting), ' +
    'a Chinese manufacturer of professional stage lighting (moving head beam/spot/wash, ' +
    'LED par, laser projector, outdoor IP65, DMX controllers).\n\n' +
    'An inbound inquiry arrived. Analyse it and draft a reply.\n\n' +
    'HARD RULES:\n' +
    '- Never invent prices, MOQ, lead times, certifications or model numbers.\n' +
    '- If a technical detail is unknown, ask the customer instead of guessing.\n' +
    '- Reply in the SAME language as the customer message.\n' +
    '- Professional, concise B2B tone. Max 180 words.\n\n' +
    'Respond with STRICT JSON only, no markdown fences:\n' +
    '{"summary":string,"intent":string,"urgency":"high|normal|low",' +
    '"score":number,"reply":string,"questions":[string]}\n\n' +
    'INQUIRY:\n' +
    'name: ' + (lead.name || '-') + '\n' +
    'company: ' + (lead.company || '-') + '\n' +
    'country: ' + (lead.country || '-') + '\n' +
    'category: ' + (lead.category || '-') + '\n' +
    'application: ' + (lead.application || '-') + '\n' +
    'quantity: ' + (lead.qty || '-') + '\n' +
    'budget: ' + (lead.budget || '-') + '\n' +
    'lead_time: ' + (lead.lead_time || '-') + '\n' +
    'trade_terms: ' + (lead.trade_terms || '-') + '\n' +
    'message: ' + (lead.raw_text || '-') + '\n';

  const r = await callAI(env, prompt, model, 600);
  if (!r.text) return { run: r, refined: null };

  const parsed = extractJson(r.text);
  if (!parsed) return { run: r, refined: null };

  const scoreNum = Number(parsed.score);
  return {
    run: r,
    refined: {
      intent: String(parsed.intent || base.intent).toLowerCase().slice(0, 24),
      urgency: ['high', 'normal', 'low'].indexOf(String(parsed.urgency).toLowerCase()) !== -1
        ? String(parsed.urgency).toLowerCase()
        : base.urgency,
      score: Number.isFinite(scoreNum) ? Math.max(0, Math.min(100, Math.round(scoreNum))) : base.score,
      summary: String(parsed.summary || '').slice(0, 400),
      reply: String(parsed.reply || '').slice(0, 3000),
    },
  };
}

// ------------------------------------------------------------- reply drafts

export function templateReply(lead, base) {
  const zh = base.lang === 'zh';
  const name = lead.name ? lead.name.split(' ')[0] : (zh ? '您好' : 'there');

  if (base.intent === 'spam') return '';

  const subject = zh
    ? '关于您的舞台灯询盘 — StageLumen (RIGE Lighting)'
    : 'Re: Your stage lighting inquiry — StageLumen (RIGE Lighting)';

  let body;
  if (zh) {
    body =
      name + ' 您好，\n\n' +
      '感谢您的询盘，我是 StageLumen（锐吉照明）的外贸工程师，已收到您的需求。\n\n' +
      '在我们准备正式报价前，想先和您确认几个关键点，以确保方案精准：\n' +
      '1. 具体应用场景与安装高度（这决定光束角与功率选型）\n' +
      '2. 预计数量与是否需要 OEM/ODM（丝印 logo、包装定制）\n' +
      '3. 目标交期与贸易条款（FOB 深圳 / CIF / DDP）\n' +
      '4. 是否需要认证文件（CE / RoHS / ETL）\n\n' +
      '确认后我们将在 24 小时内提供含阶梯价格、MOQ 与交期的正式报价单。\n\n' +
      '顺祝商祺\nStageLumen 外贸部\n' +
      '邮件 sales@rigelighting.com ｜ WhatsApp +86 180 2717 6247';
  } else {
    body =
      'Hi ' + name + ',\n\n' +
      'Thanks for reaching out — I received your inquiry and will personally handle it.\n\n' +
      'Before preparing a formal quotation, could you confirm a few details so the ' +
      'proposal is accurate:\n' +
      '1. Application & mounting height (drives beam angle and wattage selection)\n' +
      '2. Estimated quantity and whether OEM/ODM is required (logo print, custom packaging)\n' +
      '3. Target lead time and Incoterms (FOB Shenzhen / CIF / DDP)\n' +
      '4. Certification documents needed (CE / RoHS / ETL)\n\n' +
      'Once confirmed, you will have a formal quote with tiered pricing, MOQ and ' +
      'lead time within 24 hours.\n\n' +
      'Best regards,\nStageLumen Export Team\n' +
      'sales@rigelighting.com | WhatsApp +86 180 2717 6247';
  }

  return 'Subject: ' + subject + '\n\n' + body;
}
