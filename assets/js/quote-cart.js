/**
 * StageLumen — Quote cart (询价篮)
 *
 * Why this exists
 * ---------------
 * A B2B buyer almost never enquires about exactly one SKU: they are pricing a
 * rig. The industry norm (Alibaba's inquiry list, Made-in-China's RFQ basket,
 * Thomasnet quote request) is therefore a small basket — browse the catalogue,
 * tick fixtures you need, set rough quantities, then send ONE enquiry that
 * lists everything. That raises average order value and removes the "I visited
 * 9 product pages and filled in 9 forms" friction this site used to impose.
 *
 * The basket lives in localStorage, so adding items on a listing page and
 * continuing to browse does not lose them, and the /rfq page can render the
 * same basket the visitor just built.
 *
 * Entry points wired here
 * -----------------------
 *   [data-quote-add="<model|id>"]        add that product (card buttons)
 *   product-detail page                  any link to /rfq adds the fixture
 *                                        currently on screen first, using the
 *                                        quantity already typed in #qtyInput
 *   [data-cart-count]                    live basket counter in the header
 *
 * Public API
 * ----------
 *   window.SLQuoteCart = { list, add, setQty, remove, clear, count, catalog, find, onChange }
 */
(function () {
  'use strict';

  var KEY = 'sl_quote_cart_v1';
  var MAX_ITEMS = 30;

  // ---------------------------------------------------------------- storage

  function read() {
    try {
      var raw = JSON.parse(localStorage.getItem(KEY) || '[]');
      if (!Array.isArray(raw)) return [];
      // Drop anything malformed rather than letting one bad row break render.
      return raw.filter(function (it) { return it && typeof it === 'object' && it.model; })
        .map(function (it) {
          return {
            model: String(it.model || '').slice(0, 60),
            name: String(it.name || '').slice(0, 160),
            image: String(it.image || '').slice(0, 400),
            category: String(it.category || '').slice(0, 60),
            price: it.price === undefined || it.price === null ? null : Number(it.price),
            qty: Math.min(Math.max(parseInt(it.qty, 10) || 1, 1), 99999),
            note: String(it.note || '').slice(0, 200),
          };
        });
    } catch (e) {
      return [];
    }
  }

  function write(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_ITEMS)));
    } catch (e) { /* private mode — the basket stays in memory for this page */ }
    emit(list);
  }

  function emit(list) {
    syncBadge();
    try {
      window.dispatchEvent(new CustomEvent('sl:cart-changed', { detail: { count: list.length, items: list } }));
    } catch (e) { /* IE-ish */ }
  }

  // ---------------------------------------------------------------- catalog

  var catalogPromise = null;
  function catalog() {
    if (!catalogPromise) {
      catalogPromise = fetch('data/products.json', { cache: 'no-cache' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }
    return catalogPromise;
  }

  function find(list, key) {
    key = String(key || '').trim().toLowerCase();
    if (!key) return null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].model && list[i].model.toLowerCase() === key) return list[i];
      if (list[i].id && list[i].id.toLowerCase() === key) return list[i];
    }
    for (var j = 0; j < list.length; j++) {
      var hay = ((list[j].model || '') + ' ' + (list[j].id || '')).toLowerCase();
      if (hay.indexOf(key) !== -1) return list[j];
    }
    return null;
  }

  /** Look up any model/id and return a basket-ready item (async). */
  function resolve(key, qty) {
    return catalog().then(function (d) {
      var p = find((d && d.products) || [], key);
      if (p) {
        return {
          model: p.model || String(key),
          name: p.name || p.model || String(key),
          image: p.image || (p.images && p.images[0]) || '',
          category: p.category || '',
          price: p.price === undefined ? null : p.price,
          qty: qty || p.moq || 1,
          note: '',
        };
      }
      // Unknown model: keep it — better a basket row we can Google than a
      // silently dropped product the customer asked for.
      return { model: String(key), name: '', image: '', category: '', price: null, qty: qty || 1, note: '' };
    });
  }

  // ------------------------------------------------------------------- API

  function list() { return read(); }
  function count() { return read().length; }

  function add(model, opts) {
    opts = opts || {};
    if (!model) return Promise.resolve(list());
    var items = read();
    var existing = null;
    for (var i = 0; i < items.length; i++) {
      if (items[i].model.toLowerCase() === String(model).toLowerCase()) { existing = items[i]; break; }
    }
    if (existing) {
      existing.qty = Math.min(existing.qty + (opts.qty || 1), 99999);
      if (!existing.image || !existing.name) {
        return resolve(model, existing.qty).then(function (full) {
          existing.image = existing.image || full.image;
          existing.name = existing.name || full.name;
          existing.category = existing.category || full.category;
          if (existing.price === null) existing.price = full.price;
          write(items);
          return items;
        });
      }
      write(items);
      return Promise.resolve(items);
    }
    return resolve(model, opts.qty).then(function (item) {
      items.push(item);
      write(items);
      return items;
    });
  }

  function setQty(model, qty) {
    var items = read();
    for (var i = 0; i < items.length; i++) {
      if (items[i].model.toLowerCase() === String(model).toLowerCase()) {
        items[i].qty = Math.min(Math.max(parseInt(qty, 10) || 1, 1), 99999);
        break;
      }
    }
    write(items);
    return items;
  }

  function remove(model) {
    var items = read().filter(function (it) {
      return it.model.toLowerCase() !== String(model).toLowerCase();
    });
    write(items);
    return items;
  }

  function clear() {
    write([]);
    return [];
  }

  // -------------------------------------------------------------------- UI

  var stylesInjected = false;
  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    var css =
      '.qc-fab{position:fixed;left:18px;bottom:18px;z-index:60;display:none;align-items:center;gap:9px;' +
        'background:linear-gradient(135deg,#ff6b00,#ff8a2b);color:#fff;text-decoration:none;' +
        'padding:11px 16px;border-radius:99px;font-weight:600;font-size:14px;' +
        'box-shadow:0 8px 26px rgba(255,107,0,.35);transition:transform .15s ease}' +
      '.qc-fab:hover{transform:translateY(-2px);color:#fff}' +
      '.qc-fab .qc-n{background:#fff;color:#ff6b00;border-radius:99px;min-width:20px;height:20px;' +
        'display:inline-flex;align-items:center;justify-content:center;font-size:12px;padding:0 6px}' +
      '.qc-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%) translateY(14px);z-index:80;' +
        'background:#121722;border:1px solid #232b3d;color:#e6ebf5;padding:11px 18px;border-radius:10px;' +
        'font-size:14px;box-shadow:0 10px 30px rgba(0,0,0,.45);opacity:0;pointer-events:none;' +
        'transition:opacity .2s ease,transform .2s ease;display:flex;gap:14px;align-items:center}' +
      '.qc-toast.on{opacity:1;transform:translateX(-50%) translateY(0);pointer-events:auto}' +
      '.qc-toast a{color:#00d4ff;font-weight:600;white-space:nowrap}' +

      /* ---- quote list panel rendered inside the RFQ form ---- */
      '.qc-panel{background:var(--panel,#121722);border:1px solid var(--line,#232b3d);border-radius:10px;padding:14px}' +
      '.qc-title{font-weight:600;margin-bottom:4px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}' +
      '.qc-title .qc-n2{font-size:11px;font-weight:600;color:#fff;background:var(--brand,#ff6b00);' +
        'border-radius:99px;padding:1px 8px}' +
      '.qc-head{display:grid;grid-template-columns:1fr 92px 34px;gap:10px;font-size:11px;text-transform:uppercase;' +
        'letter-spacing:.5px;color:var(--dim,#8b96ad);padding:8px 2px;border-bottom:1px solid var(--line,#232b3d)}' +
      '.qc-row{display:grid;grid-template-columns:1fr 92px 34px;gap:10px;align-items:center;padding:10px 2px;' +
        'border-bottom:1px solid var(--line,#232b3d)}' +
      '.qc-item{display:flex;gap:10px;align-items:center;min-width:0}' +
      '.qc-item img,.qc-item>span{width:52px;height:52px;flex:0 0 52px;object-fit:cover;border-radius:8px;' +
        'background:#0c1322;display:flex;align-items:center;justify-content:center;font-size:22px;color:var(--brand,#ff6b00)}' +
      '.qc-meta{min-width:0}' +
      '.qc-model{font-weight:700;font-size:13px;letter-spacing:.2px}' +
      '.qc-name{font-size:12px;color:var(--dim,#8b96ad);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.qc-price{font-size:11px;color:#34d399}' +
      '.qc-qty{width:100%;text-align:center;padding:8px 6px}' +
      '.qc-del{background:transparent;border:1px solid var(--line,#232b3d);color:var(--dim,#8b96ad);' +
        'border-radius:8px;width:32px;height:32px;font-size:18px;line-height:1;cursor:pointer;padding:0}' +
      '.qc-del:hover{border-color:#e5484d;color:#e5484d}' +
      '.qc-foot{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--dim,#8b96ad);padding-top:10px}' +
      '.qc-clear{margin-left:auto;background:transparent;border:0;color:var(--dim,#8b96ad);' +
        'text-decoration:underline;cursor:pointer;padding:0;font-size:12px}' +
      '.qc-clear:hover{color:#e5484d}' +
      '.qc-empty{padding:18px 12px;text-align:center;color:var(--dim,#8b96ad);font-size:13px;' +
        'border:1px dashed var(--line,#232b3d);border-radius:10px}' +
      '.qc-picker{position:relative;margin-top:12px}' +
      '.qc-picker input{width:100%;padding:10px 12px}' +
      '.qc-results{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:30;display:none;' +
        'background:#121722;border:1px solid #232b3d;border-radius:10px;overflow:hidden;' +
        'box-shadow:0 14px 34px rgba(0,0,0,.45);max-height:328px;overflow-y:auto}' +
      '.qc-res{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:transparent;' +
        'border:0;border-bottom:1px solid #1c2434;color:inherit;padding:9px 12px;cursor:pointer}' +
      '.qc-res:last-child{border-bottom:0}' +
      '.qc-res:hover{background:#1b2333}' +
      '.qc-res img,.qc-res-ico{width:40px;height:40px;flex:0 0 40px;object-fit:cover;border-radius:7px;' +
        'display:flex;align-items:center;justify-content:center;background:#0c1322;color:#ff6b00}' +
      '.qc-res-txt{display:flex;flex-direction:column;min-width:0;flex:1}' +
      '.qc-res-txt strong{font-size:12px}' +
      '.qc-res-txt em{font-style:normal;font-size:11px;color:#8b96ad;overflow:hidden;' +
        'text-overflow:ellipsis;white-space:nowrap}' +
      '.qc-res-price{font-size:12px;color:#34d399;flex:0 0 auto}' +
      '.qc-res-empty{padding:14px 12px;font-size:12px;color:#8b96ad}' +

      '@media(max-width:640px){.qc-fab{left:12px;bottom:12px;padding:10px 14px;font-size:13px}' +
        '.qc-head,.qc-row{grid-template-columns:1fr 74px 30px}' +
        '.qc-item img,.qc-item>span{width:42px;height:42px;flex:0 0 42px;font-size:18px}}';
    var s = document.createElement('style');
    s.setAttribute('data-qc', '1');
    s.appendChild(document.createTextNode(css));
    document.head.appendChild(s);
  }

  var toastTimer = null;
  function toast(msg, actionHref, actionText) {
    var el = document.getElementById('qcToast');
    if (!el) return;
    el.innerHTML = '<span>' + msg + '</span>' +
      (actionHref ? '<a href="' + actionHref + '">' + (actionText || 'View quote list') + '</a>' : '');
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('on'); }, 3600);
  }

  function ensureFab() {
    if (document.getElementById('qcFab')) return document.getElementById('qcFab');
    var fab = document.createElement('a');
    fab.id = 'qcFab';
    fab.className = 'qc-fab';
    fab.href = 'rfq.html';
    fab.innerHTML = 'Quote list <span class="qc-n">0</span>';
    document.body.appendChild(fab);
    return fab;
  }

  function ensureToast() {
    if (document.getElementById('qcToast')) return;
    var t = document.createElement('div');
    t.id = 'qcToast';
    t.className = 'qc-toast';
    document.body.appendChild(t);
  }

  /** Total across the basket, used for the "Estimated Quantity" prefill. */
  function totalQty(items) {
    return (items || read()).reduce(function (a, b) { return a + (b.qty || 0); }, 0);
  }

  /**
   * Category that occurs most often in the basket — used to preselect the
   * RFQ "Product Category" dropdown. Ties resolve to the FIRST item's
   * category, because that is usually the fixture the enquiry started from.
   */
  function dominantCategory(items) {
    items = items || read();
    if (!items.length) return '';
    var tally = {};
    items.forEach(function (it) {
      if (it.category) tally[it.category] = (tally[it.category] || 0) + 1;
    });
    var best = '';
    var bestN = 0;
    Object.keys(tally).forEach(function (k) { if (tally[k] > bestN) { best = k; bestN = tally[k]; } });
    var firstCat = items[0].category;
    if (firstCat && tally[firstCat] === bestN) return firstCat;
    return best;
  }

  function syncBadge() {
    var n = count();
    var nodes = document.querySelectorAll('[data-cart-count]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = String(n);
      nodes[i].style.display = n ? '' : 'none';
      var box = nodes[i].parentNode;
      if (box && box.getAttribute && box.getAttribute('data-cart-box')) {
        box.style.display = n ? '' : 'none';
      }
    }
    var fab = document.getElementById('qcFab');
    if (fab) {
      var num = fab.querySelector('.qc-n');
      if (num) num.textContent = String(n);
      // Hide the floating button on the RFQ page itself: the basket is already
      // the centrepiece of that form.
      fab.style.display = (n && !/rfq/.test(location.pathname)) ? 'flex' : 'none';
    }
  }

  // -------------------------------------------------------------- behaviour

  function currentProductKey() {
    var params = new URLSearchParams(location.search);
    return params.get('id') || params.get('product') || params.get('model') || params.get('sku') || '';
  }

  /** /rfq links written by the detail page carry ?product=<id> in their href. */
  function keyFromLink(a) {
    try {
      var href = a.getAttribute('href') || '';
      var q = href.indexOf('?');
      if (q === -1) return '';
      return new URLSearchParams(href.slice(q + 1)).get('product') ||
             new URLSearchParams(href.slice(q + 1)).get('sku') || '';
    } catch (e) { return ''; }
  }

  function onDocClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;

    var addBtn = t.closest('[data-quote-add]');
    if (addBtn) {
      var key = addBtn.getAttribute('data-quote-add');
      if (key) {
        e.preventDefault();
        e.stopPropagation();
        add(key, {}).then(function (items) {
          toast('Added to your quote list · ' + items.length + ' item' + (items.length > 1 ? 's' : ''),
            'rfq.html', 'Continue');
        });
      }
      return;
    }

    // On a product page, ANY link to the quote form should carry the product
    // along instead of dumping the visitor into an empty generic form.
    if (/product-detail/.test(location.pathname)) {
      var rfqLink = t.closest('a[href*="rfq"]');
      if (rfqLink && !rfqLink.getAttribute('data-qc-busy')) {
        var params = new URLSearchParams(location.search);
        var pid = params.get('id') || params.get('product') || params.get('model') || params.get('sku') || '';
        if (pid) {
          rfqLink.setAttribute('data-qc-busy', '1');
          e.preventDefault();
          e.stopPropagation();
          var qtyEl = document.getElementById('qtyInput');
          var qty = qtyEl ? Math.max(parseInt(qtyEl.value, 10) || 1, 1) : 1;
          add(pid, { qty: qty }).then(function () {
            try { if (window.slTrack) window.slTrack('rfq_click', pid, { source: 'product-detail' }); } catch (err) { /* noop */ }
            location.href = rfqLink.getAttribute('href') || 'rfq.html';
          });
        }
      }
    }
  }

  function boot() {
    injectStyles();
    ensureFab();
    ensureToast();
    // Capture phase: beat product cards whose whole <a> wraps the buttons.
    document.addEventListener('click', onDocClick, true);
    window.addEventListener('storage', function (e) { if (e.key === KEY) syncBadge(); });
    syncBadge();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.SLQuoteCart = {
    list: list,
    count: count,
    add: add,
    setQty: setQty,
    remove: remove,
    clear: clear,
    catalog: catalog,
    find: find,
    resolve: resolve,
    totalQty: totalQty,
    dominantCategory: dominantCategory,
    sync: syncBadge,
    toast: toast,
  };
})();
