/**
 * StageLumen sales assistant widget.
 *
 * Self-contained on purpose: owns its own <style> so it never depends on the
 * site stylesheet or its cache-busting version, and renders nothing until the
 * visitor opens it — a floating button costs nothing until clicked.
 *
 * Public endpoint, so the client side is defensive too: network failure shows
 * a graceful fallback with the sales email rather than a dead spinner.
 */
(function () {
  'use strict';

  var ENDPOINT = '/api/chat';
  var SALES_EMAIL = 'sales@rigelighting.com';

  var QUICK = [
    'What is your MOQ?',
    'What is the lead time?',
    'Which certifications do you have?',
    'Do you support OEM?'
  ];

  var open = false;
  var busy = false;
  var history = [];
  var els = {};

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function css() {
    var s = document.createElement('style');
    s.textContent = [
      '.sl-asst{position:fixed;right:18px;bottom:18px;z-index:9998;font-family:inherit}',
      '.sl-asst-btn{width:54px;height:54px;border-radius:50%;border:0;cursor:pointer;',
      'background:#ff6b00;color:#fff;font-size:22px;line-height:54px;text-align:center;',
      'box-shadow:0 4px 16px rgba(0,0,0,.22);padding:0}',
      '.sl-asst-btn:hover{background:#e85f00}',
      '.sl-asst-panel{display:none;position:fixed;right:18px;bottom:82px;width:340px;max-width:calc(100vw - 36px);',
      'height:440px;max-height:calc(100vh - 120px);background:#fff;border:1px solid #e3e3e3;',
      'border-radius:12px;box-shadow:0 10px 34px rgba(0,0,0,.18);flex-direction:column;overflow:hidden}',
      '.sl-asst-panel.on{display:flex}',
      '.sl-asst-head{background:#0d1117;color:#fff;padding:12px 14px;font-size:14px;font-weight:600;',
      'display:flex;justify-content:space-between;align-items:center}',
      '.sl-asst-head span{font-size:11px;opacity:.7;font-weight:400;display:block}',
      '.sl-asst-close{background:none;border:0;color:#fff;font-size:20px;cursor:pointer;line-height:1;padding:0 4px}',
      '.sl-asst-body{flex:1;overflow-y:auto;padding:12px;background:#fafafa;font-size:13px;line-height:1.55}',
      '.sl-msg{margin-bottom:10px;max-width:88%;padding:8px 11px;border-radius:10px;white-space:pre-wrap;word-break:break-word}',
      '.sl-msg.me{background:#ff6b00;color:#fff;margin-left:auto;border-bottom-right-radius:3px}',
      '.sl-msg.bot{background:#fff;border:1px solid #e6e6e6;color:#222;border-bottom-left-radius:3px}',
      '.sl-quick{padding:8px 12px 0;display:flex;flex-wrap:wrap;gap:6px}',
      '.sl-chip{border:1px solid #ff6b00;color:#ff6b00;background:#fff;border-radius:14px;',
      'padding:5px 10px;font-size:12px;cursor:pointer}',
      '.sl-chip:hover{background:#fff3e8}',
      '.sl-asst-foot{border-top:1px solid #ececec;padding:8px;display:flex;gap:6px;background:#fff}',
      '.sl-asst-foot input{flex:1;border:1px solid #ddd;border-radius:8px;padding:8px 10px;font-size:13px;outline:none}',
      '.sl-asst-foot input:focus{border-color:#ff6b00}',
      '.sl-send{background:#ff6b00;border:0;color:#fff;border-radius:8px;padding:0 14px;cursor:pointer;font-size:13px}',
      '.sl-send:disabled{opacity:.5;cursor:default}',
      '.sl-src{font-size:11px;color:#888;margin-top:4px}'
    ].join('');
    document.head.appendChild(s);
  }

  function currentSku() {
    var m = location.search.match(/[?&](?:sku|id|model)=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function push(who, text) {
    var n = el('div', 'sl-msg ' + (who === 'me' ? 'me' : 'bot'), text);
    els.body.appendChild(n);
    els.body.scrollTop = els.body.scrollHeight;
    return n;
  }

  function setBusy(v) {
    busy = v;
    els.send.disabled = v;
    els.input.disabled = v;
    els.send.textContent = v ? '…' : 'Send';
  }

  function ask(text) {
    text = String(text || '').trim();
    if (!text || busy) return;

    push('me', text);
    history.push({ role: 'user', content: text });
    els.input.value = '';
    setBusy(true);

    var wait = push('bot', '…');

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: text,
        sku: currentSku(),
        pageUrl: location.href
      })
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (d) {
        wait.textContent = (d && d.reply) || "Sorry, I couldn't answer that.";
        if (d && d.degraded) {
          var s = el('div', 'sl-src', 'Answered from knowledge base');
          wait.appendChild(s);
        }
        els.body.scrollTop = els.body.scrollHeight;
      })
      .catch(function () {
        wait.textContent =
          "I can't reach the assistant right now. Please email " +
          SALES_EMAIL +
          ' and a sales engineer will reply within 24 hours.';
      })
      .then(function () {
        setBusy(false);
        els.input.focus();
      });
  }

  function build() {
    css();

    var root = el('div', 'sl-asst');
    var panel = el('div', 'sl-asst-panel');
    var head = el('div', 'sl-asst-head');

    var title = el('div');
    title.appendChild(document.createTextNode('StageLumen Assistant'));
    title.appendChild(el('span', null, 'Typical reply: under 24h by email'));

    var close = el('button', 'sl-asst-close', '×');
    close.setAttribute('aria-label', 'Close');
    close.onclick = toggle;

    head.appendChild(title);
    head.appendChild(close);

    var body = el('div', 'sl-asst-body');
    var quick = el('div', 'sl-quick');
    var foot = el('div', 'sl-asst-foot');
    var input = el('input');
    input.type = 'text';
    input.placeholder = 'Ask about MOQ, lead time, specs…';
    input.setAttribute('aria-label', 'Your question');
    var send = el('button', 'sl-send', 'Send');

    foot.appendChild(input);
    foot.appendChild(send);

    panel.appendChild(head);
    panel.appendChild(body);
    panel.appendChild(quick);
    panel.appendChild(foot);

    var btn = el('button', 'sl-asst-btn', '💬');
    btn.setAttribute('aria-label', 'Chat with sales');
    btn.onclick = toggle;

    root.appendChild(panel);
    root.appendChild(btn);
    document.body.appendChild(root);

    els = { panel: panel, body: body, input: input, send: send, btn: btn };

    QUICK.forEach(function (q) {
      var c = el('button', 'sl-chip', q);
      c.onclick = function () { ask(q); };
      quick.appendChild(c);
    });

    send.onclick = function () { ask(input.value); };
    input.onkeydown = function (e) {
      if (e.key === 'Enter') { e.preventDefault(); ask(input.value); }
    };

    push('bot', 'Hi — ask me about products, MOQ, lead time or certifications. For pricing, submit an RFQ and we will reply within 24 hours.');
  }

  function toggle() {
    open = !open;
    els.panel.classList.toggle('on', open);
    els.btn.textContent = open ? '×' : '💬';
    if (open) setTimeout(function () { els.input.focus(); }, 60);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
