/**
 * RiGeBa Lighting — real inquiry capture (P0)
 *
 * Takes over every `form[data-ajax]` and posts it to /api/inquiry.
 * Registered in the CAPTURE phase on `document`, so it always runs before
 * the legacy mock handler in main.js and can cancel it.
 *
 * Field mapping is driven by the `name` attribute (the contract with
 * functions/api/inquiry.js); the <label> text map below is only a fallback for
 * legacy markup. Attachments are uploaded one at a time to /api/upload before
 * the enquiry itself — a slow drawing must never cost us the lead.
 */
(function () {
  'use strict';

  // Signals to main.js that the real handler is active (legacy mock stands down).
  window.SL_INQUIRY_ACTIVE = true;

  var ENDPOINT = '/api/inquiry';
  var UPLOAD = '/api/upload';

  // Mirrors functions/api/upload.js. Duplicated on purpose: the visitor gets
  // told immediately instead of after a round trip that costs them a minute.
  var MAX_FILES = 5;
  var MAX_BYTES = 10 * 1024 * 1024;
  var OK_EXT = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'dwg', 'dxf', 'skp',
    'rvt', 'ies', 'zip', 'rar', '7z', 'xlsx', 'xls', 'ods', 'doc', 'docx', 'odt',
    'ppt', 'pptx', 'txt', 'rtf'];

  /**
   * The RFQ form ships in English, German and Spanish. Field mapping no longer
   * depends on the copy (every control carries a `name`), but the visitor still
   * deserves status text in their own language — this block is why /de/ and
   * /es/ no longer answer in English.
   */
  function langKey() {
    var l = String((document.documentElement && document.documentElement.getAttribute('lang')) || 'en');
    l = l.slice(0, 2).toLowerCase();
    return (l === 'de' || l === 'es') ? l : 'en';
  }

  var I18N = {
    en: {
      sending: 'Submitting your request…',
      busy: 'Sending…',
      uploading: 'Uploading files ({n})…',
      badEmail: 'Please enter a valid business email.',
      ok: '✓ Thanks! Our sales engineer will reply within 24 hours',
      urgent: ' (flagged urgent).',
      acked: ' A confirmation has been sent to your inbox — please check your spam folder if it does not arrive.',
      attachWarn: ' Some files could not be uploaded — please email them to sales20@rigelighting.com.',
      wa: ' Need it faster? WhatsApp +86 134 3026 2182.',
      fail: 'Something went wrong. Please email sales20@rigelighting.com or WhatsApp +86 134 3026 2182.'
    },
    de: {
      sending: 'Ihre Anfrage wird gesendet…',
      busy: 'Wird gesendet…',
      uploading: 'Dateien werden hochgeladen ({n})…',
      badEmail: 'Bitte geben Sie eine gültige geschäftliche E-Mail-Adresse ein.',
      ok: '✓ Danke! Unser Vertrieb antwortet innerhalb von 24 Stunden',
      urgent: ' (als dringend markiert).',
      acked: ' Eine Bestätigung wurde an Ihr Postfach gesendet — prüfen Sie bitte auch den Spam-Ordner.',
      attachWarn: ' Einige Dateien konnten nicht übertragen werden — bitte senden Sie sie per E-Mail an sales20@rigelighting.com.',
      wa: ' Eilt es? WhatsApp +86 134 3026 2182.',
      fail: 'Es ist ein Fehler aufgetreten. Bitte schreiben Sie an sales20@rigelighting.com oder per WhatsApp +86 134 3026 2182.'
    },
    es: {
      sending: 'Enviando su solicitud…',
      busy: 'Enviando…',
      uploading: 'Subiendo archivos ({n})…',
      badEmail: 'Introduzca un correo comercial válido.',
      ok: '✓ ¡Gracias! Nuestro equipo responderá en 24 horas',
      urgent: ' (marcada como urgente).',
      acked: ' Hemos enviado una confirmación a su correo — revise también la carpeta de spam.',
      attachWarn: ' Algunos archivos no se pudieron enviar — envíelos por correo a sales20@rigelighting.com.',
      wa: ' ¿Lo necesita antes? WhatsApp +86 134 3026 2182.',
      fail: 'Algo salió mal. Escríbanos a sales20@rigelighting.com o por WhatsApp +86 134 3026 2182.'
    }
  };

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

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function kbLabel(n) {
    var v = Number(n) || 0;
    if (v >= 1024 * 1024) return (v / 1024 / 1024).toFixed(1) + ' MB';
    if (v >= 1024) return Math.round(v / 1024) + ' KB';
    return v + ' B';
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
      // File inputs carry a fake path in .value; the real files travel through
      // /api/upload and reach the server as descriptors in `attachments`.
      if (el.type === 'file') continue;
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
    // Summarise the quote list into the free-text brief as well. Sales people
    // read this first, and it makes the basket visible even in channels that
    // only forward the message body.
    if (out.items) {
      try {
        var lines = JSON.parse(out.items).map(function (it) {
          return '- ' + it.model + ' x' + it.qty + (it.name ? ' — ' + it.name : '');
        });
        if (lines.length) {
          out.message = (out.message ? out.message + '\n\n' : '') + 'Quote list:\n' + lines.join('\n');
        }
      } catch (e) { /* malformed basket is not a reason to drop the enquiry */ }
    }
    return out;
  }

  // ------------------------------------------------------------- attachments

  function fileInput(form) {
    return form.querySelector('input[type="file"][data-attach]');
  }

  function extOf(name) {
    var m = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || ''));
    return m ? m[1].toLowerCase() : '';
  }

  /**
   * The FileList on an <input type=file> is read-only, and older browsers make
   * writing a merged list back awkward. So the picked files live in
   * `form._slFiles` and the input is only a picker — one source of truth for
   * both the drop zone and the remove buttons.
   */
  function collectFiles(form) {
    if (form._slFiles) return form._slFiles;
    var input = fileInput(form);
    form._slFiles = (input && input.files) ? Array.prototype.slice.call(input.files) : [];
    return form._slFiles;
  }

  function syncInput(form) {
    var input = fileInput(form);
    if (!input) return;
    try {
      if (typeof DataTransfer === 'undefined') return;
      var dt = new DataTransfer();
      collectFiles(form).forEach(function (f) { dt.items.add(f); });
      input.files = dt.files;
    } catch (e) { /* the shadow list is authoritative anyway */ }
  }

  /** Splits the picked files into what we can send and what we cannot. */
  function pickFiles(form) {
    var all = collectFiles(form);
    var list = [];
    var rejected = [];
    for (var i = 0; i < all.length; i++) {
      var f = all[i];
      if (OK_EXT.indexOf(extOf(f.name)) === -1) {
        rejected.push(f.name + ' — file type not accepted');
        continue;
      }
      if (f.size > MAX_BYTES) {
        rejected.push(f.name + ' — larger than 10 MB');
        continue;
      }
      if (list.length >= MAX_FILES) {
        rejected.push(f.name + ' — only ' + MAX_FILES + ' files per enquiry');
        continue;
      }
      list.push(f);
    }
    return { list: list, rejected: rejected };
  }

  function renderFiles(form, rejected) {
    var box = form.querySelector('[data-file-list]');
    if (!box) return;
    var chips = collectFiles(form).map(function (f, i) {
      return '<span class="file-chip"><span class="fc-name">' + esc(f.name) + '</span>' +
        '<span class="fc-size">' + kbLabel(f.size) + '</span>' +
        '<button type="button" class="fc-x" data-file-remove="' + i + '" ' +
        'aria-label="Remove">&times;</button></span>';
    });
    if (rejected && rejected.length) {
      chips = chips.concat(rejected.map(function (r) {
        return '<span class="file-chip is-bad"><span class="fc-name">' + esc(r) + '</span></span>';
      }));
    }
    box.innerHTML = chips.join('');
  }

  /**
   * Upload sequentially. Parallel puts from one visitor are exactly what our own
   * rate limiter treats as abuse, and a failure here must never cost the lead:
   * the caller submits the enquiry regardless and lists what did not make it.
   */
  function uploadAll(files, form) {
    var ok = [];
    var failed = [];
    if (!files.length) return Promise.resolve({ ok: ok, failed: failed });
    var T = I18N[langKey()];
    var chain = Promise.resolve();

    files.forEach(function (f, i) {
      chain = chain.then(function () {
        setStatus(form, T.uploading.replace('{n}', (i + 1) + '/' + files.length), 'loading');
        var fd = new FormData();
        fd.append('file', f, f.name);
        return fetch(UPLOAD, { method: 'POST', body: fd })
          .then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (d) {
              return { status: r.status, data: d };
            });
          })
          .then(function (res) {
            if (res.data && res.data.ok && res.data.files && res.data.files.length) {
              ok.push(res.data.files[0]);
            } else {
              failed.push(f.name);
            }
          })
          .catch(function () { failed.push(f.name); });
      });
    });

    return chain.then(function () { return { ok: ok, failed: failed }; });
  }

  function bindAttachmentUi(form) {
    var input = fileInput(form);
    var drop = form.querySelector('[data-file-drop]');
    if (!input) return;

    input.addEventListener('change', function () {
      form._slFiles = Array.prototype.slice.call(input.files || []);
      renderFiles(form);
    });

    if (!drop) return;

    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) {
        e.preventDefault();
        drop.classList.add('is-over');
      });
    });
    ['dragleave', 'dragend'].forEach(function (ev) {
      drop.addEventListener(ev, function () { drop.classList.remove('is-over'); });
    });
    drop.addEventListener('drop', function (e) {
      e.preventDefault();
      drop.classList.remove('is-over');
      var dt = e.dataTransfer;
      if (!dt || !dt.files || !dt.files.length) return;
      var next = collectFiles(form).concat(Array.prototype.slice.call(dt.files));
      form._slFiles = next;
      syncInput(form);
      renderFiles(form);
    });
  }

  // ------------------------------------------------------------------ submit

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

  function send(form, payload, T, failedFiles) {
    var status = form.querySelector('[data-status]');
    var btn = form.querySelector('button[type="submit"]');
    var failed = failedFiles || [];

    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (data) {
        if (data && data.ok) {
          // Milestone for the traffic funnel (no-op when the visitor declined
          // analytics; loaded from track.js, hence the guard).
          try {
            if (window.slTrack) {
              window.slTrack('inquiry_submitted', payload.sku || '', {
                category: payload.category || '',
                files: failed.length ? 0 : (payload.attachments ? 1 : 0)
              });
            }
          } catch (e) { /* never break the form */ }
          // The enquiry left with its own copy of the basket, so it can be
          // emptied now — otherwise the next enquiry re-sends this one's list.
          try { if (window.SLQuoteCart) window.SLQuoteCart.clear(); } catch (e) { /* noop */ }
          var acked = data.autoreply && data.autoreply.sent;
          setStatus(
            form,
            T.ok +
              (data.triage && data.triage.urgency === 'high' ? T.urgent : '.') +
              (acked ? T.acked : '') +
              (failed.length ? T.attachWarn : '') +
              T.wa,
            'success'
          );
          if (status) status.style.color = '#16a34a';
          form.reset();
          form._slFiles = [];
          renderFiles(form);
        } else {
          throw new Error((data && data.error) || 'Submission failed');
        }
      })
      .catch(function (err) {
        // The API answers with actionable reasons ("A valid business email is
        // required.", "Too many requests…"). Those used to be thrown away in
        // favour of a dead-end notice, losing enquiries that were one field
        // away from being sent. Pass anything clearly meant for the visitor
        // through; fall back only for genuine failures.
        var msg = String((err && err.message) || '').trim();
        var recoverable = /required|valid|tell us|too many|rate/i.test(msg);
        setStatus(form, recoverable ? msg : T.fail, 'error');
        if (status) status.style.color = '#e5484d';
        console.error('[inquiry]', err);
      })
      .then(function () {
        form.removeAttribute('data-sl-busy');
        if (btn) { btn.disabled = false; if (btn.getAttribute('data-sl-text')) btn.textContent = btn.getAttribute('data-sl-text'); }
      });
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
    var T = I18N[langKey()];

    if (!payload.email) {
      setStatus(form, T.badEmail, 'error');
      if (status) status.style.color = '#e5484d';
      return;
    }

    var utm = firstTouch();
    payload.pageUrl = location.href;
    // navigator.language described the *browser*, so a German buyer on a German
    // phone was filed as 'en' whenever their UI language was English. The page
    // language is what we actually serve.
    payload.lang = langKey();
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
    // The dropdown and the basket both answer "what do they want", and the
    // sales board reads product_category — never hand it an empty value when
    // the form has an answer.
    if (!payload.productCategory && payload.category) payload.productCategory = payload.category;
    // The honeypot (input[name=hp]) is a real field in the markup, so it is
    // deliberately NOT cleared here — blanking it made the trap useless. A bot
    // that autofills every input trips it and the API drops the post.

    addHoneypot(form);
    form.setAttribute('data-sl-busy', '1');
    if (btn) { btn.disabled = true; btn.setAttribute('data-sl-text', btn.textContent); btn.textContent = T.busy; }
    setStatus(form, T.sending, 'loading');

    var picks = pickFiles(form);
    renderFiles(form, picks.rejected);

    uploadAll(picks.list, form).then(function (res) {
      if (res.ok.length) payload.attachments = JSON.stringify(res.ok);
      // Anything that failed to upload still gets named in the brief. Sales can
      // then ask for it directly instead of quoting against a missing drawing
      // they never knew existed.
      var failed = res.failed.concat(picks.rejected);
      if (failed.length) {
        var note = 'Attachments not uploaded: ' + failed.join('; ');
        payload.message = (payload.message ? payload.message + '\n\n' : '') + note;
      }
      return send(form, payload, T, res.failed);
    });
  }

  // Capture phase on document => runs before main.js's bubble-phase handler.
  document.addEventListener('submit', onSubmit, true);

  // Remove buttons live in the file chips, which are re-rendered on every
  // change — so the handler is delegated rather than bound per chip.
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    var idx = t.getAttribute('data-file-remove');
    if (idx === null) return;
    var form = t.closest ? t.closest('form') : null;
    if (!form) return;
    e.preventDefault();
    collectFiles(form).splice(Number(idx), 1);
    syncInput(form);
    renderFiles(form);
  });

  // Carry the SKU from a product page into the RFQ form + wire up drop zones.
  document.addEventListener('DOMContentLoaded', function () {
    var forms = document.querySelectorAll('form[data-ajax], form[data-inquiry]');
    for (var f = 0; f < forms.length; f++) bindAttachmentUi(forms[f]);

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
