/**
 * StageLumen — first-party, cookieless analytics beacon
 *
 * What it records: pageviews, product views, RFQ clicks, product clicks, and
 * any [data-track] element. A random visitor id (localStorage, no PII) lets us
 * count unique visitors and build a view → quote → inquiry funnel.
 *
 * Privacy: gated on the site's cookie-consent banner. Tracking only starts
 * after the visitor accepts (localStorage 'stagelumen_cookie_consent' ===
 * 'accepted'). No cross-site cookies, no raw IP stored.
 */
(function () {
  'use strict';

  var started = false;
  var ENDPOINT = '/api/track';

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

  function consented() {
    try { return localStorage.getItem('stagelumen_cookie_consent') === 'accepted'; }
    catch (e) { return false; }
  }

  function send(ev) {
    try {
      ev.visitor = vid();
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
    if (started) return;
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

  // Gate on consent; start immediately if already accepted.
  if (consented()) {
    start();
  } else {
    window.addEventListener('sl:consent-changed', function (e) {
      if (e && e.detail && e.detail.value === 'accepted') start();
    });
  }
})();
