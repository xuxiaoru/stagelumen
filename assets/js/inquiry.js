/**
 * StageLumen — real inquiry capture (P0)
 *
 * Takes over every `form[data-ajax]` and posts it to /api/inquiry.
 * Registered in the CAPTURE phase on `document`, so it always runs before
 * the legacy mock handler in main.js and can cancel it.
 *
 * Field mapping needs no `name` attributes: it reads the <label> text of each
 * .form-group, which means existing markup is untouched.
 */
(function () {
  'use strict';

  // Signals to main.js that the real handler is active (legacy mock stands down).
  window.SL_INQUIRY_ACTIVE = true;

  var ENDPOINT = '/api/inquiry';

  var LABEL_MAP = {
    'first name': 'firstName',
    'last name': 'lastName',
    'business email': 'email',
    'email address': 'email',
    'email': 'email',
    'phone / whatsapp': 'phone',
    'phone': 'phone',
    'whatsapp': 'phone',
    'company name': 'company',
    'company': 'company',
    'country': 'country',
    'product category': 'category',
    'category': 'category',
    'application': 'application',
    'estimated quantity': 'qty',
    'quantity': 'qty',
    'target budget': 'budget',
    'budget': 'budget',
    'lead time expected': 'leadTime',
    'lead time': 'leadTime',
    'trade terms': 'tradeTerms',
    'project details': 'message',
    'your message': 'message',
    'message': 'message',
    'enquiry': 'message',
    'inquiry': 'message'
  };

  var MAP_KEYS = Object.keys(LABEL_MAP);

  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/\*/g, '')
      .replace(/\([^)]*\)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function fieldKey(el) {
    if (el.name) return el.name;
    var group = el.closest ? el.closest('.form-group, .field, .input-group') : null;
    var label = group ? group.querySelector('label') : null;
    var text = norm(label ? label.textContent : '');
    if (!text) {
      // Fall back to input type heuristics.
      if (el.type === 'email') return 'email';
      if (el.type === 'tel') return 'phone';
      if (el.tagName === 'TEXTAREA') return 'message';
      return '';
    }
    if (LABEL_MAP[text]) return LABEL_MAP[text];
    for (var i = 0; i < MAP_KEYS.length; i++) {
      if (text.indexOf(MAP_KEYS[i]) !== -1) return LABEL_MAP[MAP_KEYS[i]];
    }
    if (el.type === 'email') return 'email';
    if (el.type === 'tel') return 'phone';
    if (el.tagName === 'TEXTAREA') return 'message';
    return '';
  }

  function serialize(form) {
    var out = {};
    var els = form.querySelectorAll('input, select, textarea');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.type === 'hidden' && el.name === 'hp') continue; // honeypot handled below
      var key = fieldKey(el);
      if (!key) continue;
      var val = String(el.value || '').trim();
      if (!val) continue;
      if (key === 'firstName' || key === 'lastName') {
        out[key] = val;
      } else if (!out[key]) {
        out[key] = val;
      }
    }
    if (!out.message) {
      // Concatenate any leftovers so no customer text is ever dropped.
      var extra = [];
      for (var j = 0; j < els.length; j++) {
        var e2 = els[j];
        if (e2.tagName === 'TEXTAREA' && String(e2.value || '').trim()) {
          extra.push(String(e2.value).trim());
        }
      }
      if (extra.length) out.message = extra.join('\n\n');
    }
    if (!out.name && (out.firstName || out.lastName)) {
      out.name = [out.firstName, out.lastName].join(' ').trim();
    }
    return out;
  }

  function currentSku() {
    var p = new URLSearchParams(location.search);
    var v = p.get('sku') || p.get('model') || p.get('id') || '';
    if (v) return v;
    var el = document.querySelector('[data-sku], input[name="sku"], #sku');
    return el ? (el.value || el.getAttribute('data-sku') || '') : '';
  }

  function firstTouch() {
    try {
      var raw = sessionStorage.getItem('sl_utm');
      if (raw) return JSON.parse(raw);
      var p = new URLSearchParams(location.search);
      var data = {
        utm_source: p.get('utm_source') || '',
        utm_medium: p.get('utm_medium') || '',
        utm_campaign: p.get('utm_campaign') || '',
        gclid: p.get('gclid') || '',
        fbclid: p.get('fbclid') || '',
        ref: document.referrer || ''
      };
      sessionStorage.setItem('sl_utm', JSON.stringify(data));
      return data;
    } catch (e) {
      return {};
    }
  }

  function setStatus(form, text, cls) {
    var el = form.querySelector('[data-status]');
    if (!el) {
      el = document.createElement('div');
      el.setAttribute('data-status', '');
      el.className = 'form-status';
      form.appendChild(el);
    }
    el.textContent = text;
    el.className = 'form-status' + (cls ? ' ' + cls : '');
  }

  function addHoneypot(form) {
    if (form.querySelector('input[name="hp"]')) return;
    var hp = document.createElement('input');
    hp.type = 'text';
    hp.name = 'hp';
    hp.tabIndex = -1;
    hp.autocomplete = 'off';
    hp.style.cssText =
      'position:absolute;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none';
    hp.setAttribute('aria-hidden', 'true');
    form.appendChild(hp);
  }

  function onSubmit(e) {
    var form = e.target;
    if (!form || form.tagName !== 'FORM') return;
    if (!form.matches('form[data-ajax], form[data-inquiry]')) return;

    // Cancel the legacy mock handler in main.js and the native submit.
    e.preventDefault();
    e.stopImmediatePropagation();

    if (form.getAttribute('data-sl-busy') === '1') return;

    var status = form.querySelector('[data-status]');
    var btn = form.querySelector('button[type="submit"]');
    var payload = serialize(form);

    if (!payload.email) {
      setStatus(form, 'Please enter a valid business email.', 'error');
      if (status) status.style.color = '#e5484d';
      return;
    }

    var utm = firstTouch();
    payload.pageUrl = location.href;
    payload.lang = navigator.language && navigator.language.indexOf('zh') === 0 ? 'zh' : 'en';
    payload.utm = JSON.stringify(utm);
    payload.sku = payload.sku || currentSku();

    // Only a product page has a product name in its <h1>. On /rfq the <h1> is
    // the page title ("Get a tailored quote"), which used to be saved as if it
    // were a product — polluting the lead record with nonsense.
    var onProductPage = /product-detail/.test(location.pathname) || !!payload.sku;
    if (onProductPage) {
      var h1 = document.querySelector('h1');
      if (h1) payload.productName = String(h1.textContent || '').trim().slice(0, 160);
    }
    payload.hp = '';

    addHoneypot(form);
    form.setAttribute('data-sl-busy', '1');
    if (btn) { btn.disabled = true; btn.setAttribute('data-sl-text', btn.textContent); btn.textContent = 'Sending…'; }
    setStatus(form, 'Submitting your request…', 'loading');

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (data) {
        if (data && data.ok) {
          setStatus(
            form,
            '✓ Thanks! Our sales engineer will reply within 24 hours' +
              (data.triage && data.triage.urgency === 'high' ? ' (flagged urgent).' : '.'),
            'success'
          );
          if (status) status.style.color = '#16a34a';
          form.reset();
        } else {
          throw new Error((data && data.error) || 'Submission failed');
        }
      })
      .catch(function (err) {
        setStatus(form, 'Something went wrong. Please email sales@rigelighting.com', 'error');
        if (status) status.style.color = '#e5484d';
        console.error('[inquiry]', err);
      })
      .then(function () {
        form.removeAttribute('data-sl-busy');
        if (btn) { btn.disabled = false; if (btn.getAttribute('data-sl-text')) btn.textContent = btn.getAttribute('data-sl-text'); }
      });
  }

  // Capture phase on document => runs before main.js's bubble-phase handler.
  document.addEventListener('submit', onSubmit, true);

  // Carry the SKU from a product page into the RFQ form.
  document.addEventListener('DOMContentLoaded', function () {
    var sku = currentSku();
    if (!sku) return;
    var links = document.querySelectorAll('a[href^="rfq.html"], a[href*="/rfq"]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (a.getAttribute('data-sku-bound')) continue;
      a.setAttribute('data-sku-bound', '1');
      a.href = a.href.split('#')[0] + (a.href.indexOf('?') === -1 ? '?' : '&') + 'sku=' + encodeURIComponent(sku);
    }
  });
})();
