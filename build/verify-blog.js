#!/usr/bin/env node
/**
 * Fact-check draft posts against the real catalogue before review.
 *
 *   node build/verify-blog.js            check every content/blog/*.md
 *   node build/verify-blog.js <file.md>  check one
 *
 * Exits non-zero when an ERROR is found, so it can gate a build later.
 * It exists because Workers AI drafts have invented model numbers, called a
 * wash fixture a beam, and claimed IP20 suits outdoor use. Reviewing English
 * prose by eye misses exactly those mistakes.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BLOG_DIR = path.join(ROOT, 'content', 'blog');
const CATALOGUE = path.join(ROOT, 'data', 'products.json');

const MODEL_RE = /\b(?:SL|RG|FG|EP|TS|SH)-[A-Za-z0-9][A-Za-z0-9-]{1,22}/g;

// Generic marketing filler the prompt already bans but models keep emitting.
const FILLER = [
  /\bin\s+today'?s\s+(fast[- ]paced|competitive|ever[- ]evolving)\b/i,
  /\bin\s+conclusion\b/i,
  /\bto\s+sum\s+(it\s+)?up\b/i,
  /\bit'?s\s+important\s+to\s+note\s+that\b/i,
  /\bwhen\s+it\s+comes\s+to\b/i,
];

// Claims that are wrong on their face regardless of catalogue.
const TRAPS = [
  {
    re: /IP\s?20[^0-9][^.]{0,80}\b(outdoor|outside|weather|rain|open[- ]air)\b/i,
    msg: 'IP20 is an indoor rating — it must not be recommended for outdoor use.',
  },
  {
    re: /IP\s?6[5-8][^.]{0,80}\b(indoor|interior)\s+(only|use)\b/i,
    msg: 'IP65+ is weatherproof — describing it as indoor-only is wrong.',
  },
  {
    re: /\b16[- ]bit\b[^.]{0,120}\b(one|1)\s+DMX\s+channel/i,
    msg: '16-bit uses two channels (coarse + fine), not one.',
  },
  {
    re: /\bDMX\s*(512)?\s+(output|out)\b/i,
    msg: 'Fixtures receive DMX, they do not output it. Say "DMX input".',
  },
  {
    // "a DMX universe (512 channels)" is fine — that is the console-side
    // capacity. "the number of universes a fixture supports" is not.
    re: /\buniverses?\s+(a|per|each|the)\s+fixture/i,
    msg: 'Universes belong to consoles and desks, not fixtures.',
  },
  {
    re: /\bfixtures?\s+(with|has|have|offering)\s+\d*\s*universes/i,
    msg: 'Fixtures do not carry universes — consoles do.',
  },
];

function loadCatalogue() {
  if (!fs.existsSync(CATALOGUE)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));
    const list = Array.isArray(j) ? j : j.products || [];
    const models = new Set();
    const specs = new Map();
    for (const p of list) {
      const m = String(p.model || '').toUpperCase();
      if (!m) continue;
      models.add(m);
      const s = {};
      for (const x of p.specs || []) s[String(x.label).toLowerCase()] = String(x.value);
      specs.set(m, s);
    }
    return { models, specs };
  } catch (e) {
    return null;
  }
}

/**
 * Front matter reader for the flat shape the CMS and the content agent write:
 * scalars (key: "value") plus one level of "- item" lists (tags, faq).
 *
 * The list branch matters: without it `faq:` parsed as an empty string and the
 * FAQ coverage of every post silently read as zero. Kept identical to the
 * reader in build/blog.js so a file cannot pass one and fail the other.
 */
function parseFrontMatter(text) {
  const src = String(text).replace(/^\uFEFF/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (!m) return { data: {}, body: src };

  const data = {};
  let listKey = null;

  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line === '---') continue;

    if (listKey && /^-\s+/.test(line)) {
      data[listKey].push(line.replace(/^-\s+/, '').trim().replace(/^"(.*)"$/, '$1'));
      continue;
    }

    const i = line.indexOf(':');
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (/^"(.*)"$/.test(val)) val = val.slice(1, -1);

    if (val === '') {
      data[key] = [];
      listKey = key;
    } else {
      data[key] = val;
      listKey = null;
    }
  }
  return { data, body: src.slice(m[0].length) };
}

/**
 * The house GEO structure, in one place.
 *
 * These are the requirements that decide whether a generative engine quotes the
 * page. They are ERRORs (not warnings) because the whole point is to stop a
 * thin post shipping: an article that fails this is not publishable.
 * Mirrored by the GEO block in functions/_lib/content.js factCheck().
 */
const GEO = {
  // 1,000 words of dense, factual body — roughly a 30% increase on the 2026-09
  // back-catalogue average. Chosen over 1,500 because every article that clears
  // this bar already carries three or four real catalogue tables, and padded
  // word count does not earn citations; sourced tables do.
  minWords: 1000,
  minQuestions: 4,
  minTables: 2,
  minFaq: 4,
  maxFaq: 6,
};

function geoChecks(body, data) {
  const problems = [];
  const headings = body.match(/^##\s+(.+)$/gm) || [];
  const questions = headings.filter((h) => /\?\s*$/.test(h));
  const tables = (body.match(/^\|(?:[-: ]+\|)+\s*$/gm) || []).length;
  const faq = Array.isArray(data.faq) ? data.faq.filter((f) => String(f).indexOf('::') > 0) : [];

  if (!/^##\s+(the\s+)?short\s+answer\b/im.test(body)) {
    problems.push(['ERROR', 'GEO: missing the "## The short answer" block']);
  }
  if (questions.length < GEO.minQuestions) {
    problems.push(['ERROR', 'GEO: ' + questions.length + ' question-form H2(s), need ' + GEO.minQuestions + '+']);
  }
  if (tables < GEO.minTables) {
    problems.push(['ERROR', 'GEO: ' + tables + ' data table(s), need ' + GEO.minTables + '+']);
  }
  if (faq.length < GEO.minFaq) {
    problems.push(['ERROR', 'GEO: ' + faq.length + ' FAQ pair(s), need ' + GEO.minFaq + '-' + GEO.maxFaq]);
  }
  if (faq.length > GEO.maxFaq) {
    problems.push(['WARN', 'GEO: ' + faq.length + ' FAQ pairs — trim to ' + GEO.maxFaq]);
  }
  if (!/\]\(\/products\//.test(body)) {
    problems.push(['WARN', 'GEO: no internal link to a product page']);
  }
  for (const f of faq) {
    const s = String(f);
    if (s.length > 400) problems.push(['WARN', 'GEO: FAQ answer longer than 400 chars — trim it']);
    if (s.indexOf('::') !== s.lastIndexOf('::')) {
      problems.push(['WARN', 'GEO: FAQ item contains a second "::" — only the first one splits question from answer']);
    }
  }
  return problems;
}

function check(file, cat) {
  const raw = fs.readFileSync(file, 'utf8');
  const { data, body } = parseFrontMatter(raw);
  const problems = [];
  const notes = [];
  const rel = path.relative(ROOT, file);

  if (!data.title) problems.push(['ERROR', 'no title in front matter']);
  if (!data.category) problems.push(['WARN', 'no category — cards fall back to "Article"']);
  if (!data.excerpt) problems.push(['WARN', 'no excerpt — search snippets will be poor']);
  if (data.excerpt && data.excerpt.length > 155) {
    problems.push(['WARN', 'excerpt is ' + data.excerpt.length + ' chars (keep under 155)']);
  }
  if (!data.image) {
    notes.push('no image — the card renders a slim placeholder band instead of a photo');
  } else if (!/^(https?:)?\/\//.test(data.image) && !fs.existsSync(path.join(ROOT, data.image))) {
    problems.push(['ERROR', 'image not found on disk: ' + data.image]);
  }

  const words = (body.match(/[A-Za-z0-9''-]+/g) || []).length;
  if (words < GEO.minWords) {
    problems.push(['ERROR', 'GEO: only ' + words + ' words — the house floor is ' + GEO.minWords]);
  }

  // Model numbers must exist in the catalogue.
  const found = new Set((body.match(MODEL_RE) || []).map((m) => m.toUpperCase()));
  for (const m of found) {
    if (!cat) break;
    if (!cat.models.has(m)) {
      problems.push(['ERROR', 'model "' + m + '" does not exist in data/products.json']);
    }
  }
  if (!found.size) problems.push(['WARN', 'no model numbers cited — the post cannot sell anything']);

  // A price inside a price ladder is the data the article exists to publish; a
  // price in running prose on an article with no ladder is a throwaway figure
  // that dates. Only the second case is flagged.
  const tables = (body.match(/^\|(?:[-: ]+\|)+\s*$/gm) || []).length;
  if (tables === 0) {
    const prices = body.match(/\$\s?\d{2,5}/g) || [];
    if (prices.length) {
      problems.push(['WARN', 'price with no price table: ' + prices.join(', ') + ' — put it in a ladder or link to the RFQ']);
    }
  }

  for (const re of FILLER) {
    const hit = body.match(re);
    if (hit) problems.push(['WARN', 'filler phrase: "' + hit[0] + '"']);
  }

  for (const t of TRAPS) {
    const hit = body.match(t.re);
    if (hit) problems.push(['ERROR', t.msg + ' Found: "' + hit[0].slice(0, 90) + '"']);
  }

  // Soft check: "playback" only ever belongs to a console, but the word can
  // legitimately appear when explaining console capacity, so warn do not fail.
  if (/\bplaybacks?\b/i.test(body)) {
    problems.push(['WARN', 'mentions "playback" — that is a console feature; make sure it is not attributed to a fixture']);
  }

  // House GEO structure — the checks the nightly content agent also runs.
  problems.push(...geoChecks(body, data));

  return { rel, problems, notes, words, models: [...found] };
}

function main() {
  const cat = loadCatalogue();
  if (!cat) {
    console.log('[verify] data/products.json missing or unreadable — model checks skipped');
  }

  const arg = process.argv[2];
  const files = arg
    ? [path.resolve(process.argv[2])]
    : (fs.existsSync(BLOG_DIR) ? fs.readdirSync(BLOG_DIR) : [])
        .filter((f) => f.endsWith('.md'))
        .map((f) => path.join(BLOG_DIR, f));

  if (!files.length) {
    console.log('[verify] no markdown posts found');
    return 0;
  }

  let errors = 0;
  let warns = 0;

  for (const f of files) {
    if (!fs.existsSync(f)) {
      console.log('[verify] missing file: ' + f);
      errors++;
      continue;
    }
    const r = check(f, cat);
    const errs = r.problems.filter((p) => p[0] === 'ERROR');
    const warnsList = r.problems.filter((p) => p[0] === 'WARN');
    errors += errs.length;
    warns += warnsList.length;

    const head = errs.length ? 'FAIL' : warnsList.length ? 'WARN' : 'OK  ';
    console.log('\n' + head + '  ' + r.rel + '  (' + r.words + ' words, ' + r.models.length + ' models)');
    for (const [lvl, msg] of r.problems) console.log('      ' + lvl + '  ' + msg);
    for (const n of r.notes) console.log('      note ' + n);
  }

  console.log('\n[verify] ' + files.length + ' post(s): ' + errors + ' error(s), ' + warns + ' warning(s)');
  return errors ? 1 : 0;
}

process.exit(main());
