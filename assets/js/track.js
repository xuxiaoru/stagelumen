/**
 * RiGeBa Lighting — first-party, cookieless analytics beacon
 *
 * What it records: pageviews, product views, RFQ clicks, product clicks, RFQ
 * form submissions and any [data-track] element. A random visitor id
 * (localStorage, no PII) is attached ONLY after the visitor accepts, which is
 * what lets us count unique visitors and build the view -> quote funnel.
 *
 * Consent model (IMPORTANT — this used to be broken):
 *   cookie-consent.js stores the decision as a JSON object, not a raw string:
 *       localStorage['stagelumen_cookie_consent'] = {"value":"accept"|"decline","ts":…}
 *   Reading it as `=== 'accepted'` never matched, so tracking silently never
 *   started and the analytics board stayed empty forever.
 *
 *   - decline              -> nothing is ever sent (opt-out).
 *   - no choice yet        -> anonymous pageviews/events are counted with NO
 *                             identifier and NOTHING written to storage, so the
 *                             owner still gets baseline traffic numbers.
 *   - accept               -> anonymous id added (unique visitors + funnel).
 *
 *   Set REQUIRE_CONSENT = true below for strict opt-in (track only after the
 *   visitor clicks Accept).
 *
 * Also exposes window.slTrack(name, model, meta) so other scripts (e.g.
 * inquiry.js) can record a milestone without depending on this file's internals.
 */
(function () {
  'use strict';

  var ENDPOINT = '/api/track';
  var KEY = 'stagelumen_cookie_consent';
  var REQUIRE_CONSENT = false; // true => strict opt-in (no tracking before Accept)

  var blocked = false; // visitor explicitly declined -> never send again
  var withId = false;  // visitor accepted -> attach the anonymous visitor id
  var started = false;

  function consentState() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return 'none';
      var val = raw;
      try {
        var obj = JSON.parse(raw);
        if (obj && typeof obj === 'object') val = obj.value;
      } catch (e) { /* legacy plain-string value */ }
      val = String(val || '').toLowerCase();
      if (val === 'accept' || val === 'accepted') return 'accept';
      if (val === 'decline' || val === 'declined' || val === 'reject' || val === 'rejected') return 'decline';
      return 'none';
    } catch (e) { return 'none'; }
  }

  function vid() {
    try {
      var v = localStorage.getItem('sl_vid');
      if (!v) {
        v = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        localStorage.setItem('sl_vid', v);
      }
      return v;
    } catch (e) { return ''; }
  }

  function send(ev) {
    try {
      if (blocked) return;
      if (withId) {
        var v = vid();
        if (v) ev.visitor = v;
      }
      var payload = JSON.stringify(ev);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, payload);
      } else {
        fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: payload,
          keepalive: true,
        }).catch(function () {});
      }
    } catch (e) { /* never break the page */ }
  }

  function param(name) {
    var q = new URLSearchParams(location.search).get(name);
    return q || '';
  }

  function onClick(e) {
    try {
      var t = e.target;
      var a = t.closest ? t.closest('a') : null;
      if (a) {
        var href = a.getAttribute('href') || '';
        if (/rfq\.html/.test(href)) {
          var m = param('product') || param('sku') || param('model') || param('id') || '';
          // model may live in the href itself (product-detail?product=…)
          var hp = new URLSearchParams((href.split('?')[1]) || '');
          m = m || hp.get('product') || hp.get('sku') || hp.get('id') || hp.get('model') || '';
          send({ type: 'event', name: 'rfq_click', model: m, path: location.pathname });
          return;
        }
        if (/product-detail/.test(href) || (a.closest && a.closest('.product-card'))) {
          var pp = new URLSearchParams((href.split('?')[1]) || '');
          var pm = pp.get('product') || pp.get('id') || pp.get('sku') || pp.get('model') || '';
          send({ type: 'event', name: 'product_click', model: pm, path: location.pathname });
          return;
        }
      }
      if (t.closest && t.closest('[data-track]')) {
        var el = t.closest('[data-track]');
        send({ type: 'event', name: el.getAttribute('data-track'), path: location.pathname });
      }
    } catch (e) { /* ignore */ }
  }

  function start() {
    if (started || blocked) return;
    started = true;

    // Pageview for this load.
    send({ type: 'pageview', path: location.pathname, ref: document.referrer || '' });

    // Product view (product-detail.html?product=<id>).
    if (/product-detail/.test(location.pathname)) {
      var m = param('product') || param('id') || param('sku') || param('model') || '';
      if (m) send({ type: 'event', name: 'product_view', model: m, path: location.pathname });
    }

    document.addEventListener('click', onClick, true);
  }

  /**
   * Public hook for other scripts. No-op when the visitor declined.
   * Returns true when the event was dispatched.
   */
  window.slTrack = function (name, model, meta) {
    if (blocked || !name) return false;
    send({
      type: 'event',
      name: String(name).slice(0, 60),
      model: String(model || '').slice(0, 80),
      path: location.pathname,
      meta: meta && typeof meta === 'object' ? meta : {},
    });
    return true;
  };

  // Decide the starting state once, then react to later consent changes.
  var state = consentState();
  if (state === 'decline') blocked = true;
  withId = state === 'accept';

  if (!blocked && (!REQUIRE_CONSENT || withId)) start();

  window.addEventListener('sl:consent-changed', function (e) {
    var v = e && e.detail && e.detail.value;
    v = String(v || '').toLowerCase();
    if (v === 'accept' || v === 'accepted') {
      blocked = false;
      withId = true;
      if (!started) start();
      // Mark the moment tracking became identifiable (does not double-count the
      // pageview: unique visitors are derived from visitor ids on later hits).
      send({ type: 'event', name: 'consent_accept', path: location.pathname });
    } else if (v === 'decline' || v === 'declined') {
      blocked = true;
      withId = false;
    }
  });
})();
