#!/usr/bin/env node
/**
 * Build-time settings injection.
 *
 * Reads content/settings.yml (edited in Decap CMS) and writes its values into
 * every HTML element marked with data-set="<key>".
 *
 * Cloudflare Pages build command:  node build/inject-settings.js
 *
 * Design rule: this must never be able to break the site. If settings.yml is
 * missing, unreadable or lacks a key, the HTML is left exactly as it is — the
 * hardcoded value in the markup acts as the fallback. That way the site still
 * renders correctly if the build command is not configured (yet).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'content', 'settings.yml');
const SKIP_DIRS = new Set(['node_modules', '.git', '.github', 'functions', 'build']);

/** URL scheme per key, applied to href/content attributes inside marked tags. */
const SCHEME = { email: 'mailto:', phone: 'tel:', whatsapp: 'https://wa.me/' };

/**
 * Minimal flat YAML reader: only top-level "key: value" pairs.
 * Nested blocks (e.g. social:) are ignored — nothing needs them today.
 */
function parseFlatYaml(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '');
    if (!line.trim() || /^\s/.test(line)) continue;
    const i = line.indexOf(':');
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (/^".*"$/.test(val) || /^'.*'$/.test(val)) val = val.slice(1, -1);
    if (val) out[key] = val;
  }
  return out;
}

const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escHtml(s).replace(/"/g, '&quot;');

function collectHtml(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collectHtml(p, acc);
    else if (e.name.endsWith('.html')) acc.push(p);
  }
  return acc;
}

/** <tag ...data-set="key"...>inner</tag> — inner is plain text in this codebase. */
const MARKED = /<(\w+)([^>]*\sdata-set="(\w+)"[^>]*)>([\s\S]*?)<\/\1>/g;

function main() {
  let settings;
  try {
    settings = parseFlatYaml(fs.readFileSync(SRC, 'utf8'));
  } catch (e) {
    console.log('[inject] settings.yml unreadable — keeping hardcoded values');
    return 0;
  }

  const keys = Object.keys(settings);
  console.log('[inject] settings: ' + keys.length + ' keys, email=' + (settings.email || '-'));

  let files = 0;
  let hits = 0;

  for (const file of collectHtml(ROOT)) {
    const src = fs.readFileSync(file, 'utf8');
    let n = 0;

    const out = src.replace(MARKED, (m, tag, attrs, key, inner) => {
      const val = settings[key];
      if (val == null) return m;
      n++;
      const scheme = SCHEME[key] || '';
      let v = val;
      if (key === 'whatsapp') v = String(val).replace(/[^\d]/g, '');

      const newAttrs = attrs.replace(/\b(href|content)="[^"]*"/g, (mm, attr) => {
        return attr + '="' + escAttr(scheme + v) + '"';
      });

      return '<' + tag + newAttrs + '>' + escHtml(val) + '</' + tag + '>';
    });

    if (n && out !== src) {
      fs.writeFileSync(file, out);
      files++;
      hits += n;
    }
  }

  console.log('[inject] updated ' + hits + ' element(s) across ' + files + ' file(s)');
  return 0;
}

process.exit(main());
