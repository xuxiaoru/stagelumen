/* StageLumen — GDPR Cookie Consent Banner
   Drops a single bottom-pinned banner if no prior consent recorded.
   Stores decision in localStorage under 'stagelumen_cookie_consent'.
   Triggers a custom event 'sl:consent-changed' so analytics scripts can react.
*/
(function () {
  'use strict';

  var KEY = 'stagelumen_cookie_consent';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  function emit(value) {
    try {
      window.dispatchEvent(new CustomEvent('sl:consent-changed', { detail: { value: value } }));
    } catch (e) {
      // Older browsers
      var evt = document.createEvent('Event');
      evt.initEvent('sl:consent-changed', true, true);
      evt.detail = { value: value };
      window.dispatchEvent(evt);
    }
  }

  function loadAnalytics(value) {
    if (value !== 'accept') return;
    // Hook for GA4 / Clarity / Meta Pixel — inject code here when ready.
    // Example:
    //   window.dataLayer = window.dataLayer || [];
    //   function gtag(){dataLayer.push(arguments);}
    //   gtag('js', new Date());
    //   gtag('config', 'G-XXXXXXXXXX');
  }

  function dismiss(value) {
    try { localStorage.setItem(KEY, JSON.stringify({ value: value, ts: Date.now() })); } catch (e) {}
    emit(value);
    var banner = document.getElementById('sl-cookie-banner');
    if (banner) banner.remove();
  }

  function build() {
    if (document.getElementById('sl-cookie-banner')) return;

    var html = [
      '<div id="sl-cookie-banner" class="sl-cookie" role="dialog" aria-label="Cookie consent">',
      '  <div class="sl-cookie__inner">',
      '    <div class="sl-cookie__msg">',
      '      <strong>🍪 We use cookies.</strong>',
      '      <span>We use cookies for analytics and marketing to improve your experience. See our <a href="cookies.html">Cookie Policy</a> and <a href="privacy.html">Privacy Policy</a>.</span>',
      '    </div>',
      '    <div class="sl-cookie__actions">',
      '      <button id="sl-cookie-decline" class="sl-cookie__btn sl-cookie__btn--ghost" type="button">Decline</button>',
      '      <button id="sl-cookie-accept" class="sl-cookie__btn sl-cookie__btn--primary" type="button">Accept</button>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('');

    var wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    document.body.appendChild(wrapper.firstChild);

    document.getElementById('sl-cookie-accept').addEventListener('click', function () { dismiss('accept'); loadAnalytics('accept'); });
    document.getElementById('sl-cookie-decline').addEventListener('click', function () { dismiss('decline'); });
  }

  ready(function () {
    var stored = null;
    try { stored = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    if (!stored) {
      build();
    } else {
      // Already chosen — fire event so analytics can react on subsequent load
      emit(stored.value);
      loadAnalytics(stored.value);
    }
  });
})();
