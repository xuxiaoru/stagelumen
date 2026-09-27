/**
 * RiGeBa Lighting — RFQ product section (v2, quote-cart driven)
 *
 * Replaces the old single-product "Product of Interest" panel. The visitor now
 * brings a basket (see quote-cart.js) instead of exactly one SKU:
 *
 *   - products added anywhere on the site show up here automatically
 *   - quantities are edited inline, so the enquiry carries real numbers
 *   - a search field adds more fixtures without leaving the form
 *   - everything is serialised into a hidden `items` field for the CRM, while
 *     sku / product_name / product_category / product_image are still filled
 *     with the first item so older reports and notifications keep working
 *
 * Deep links still work: /rfq.html?sku=<model> (or ?product= / ?model= / ?id=)
 * seeds the basket, which is what every legacy "Get a Quote" button sends.
 *
 * Nothing here can block a submission: if the catalogue fails to load the
 * visitor still gets the general enquiry form they always had.
 */
(function () {
  'use strict';

  var CART = window.SLQuoteCart;

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ------------------------------------------------------- form introspection */

  /**
   * Every control now carries a canonical `name`. Looking a field up by its
   * <label> text only ever worked in English, which is why the German and
   * Spanish pages kept showing the stale hardcoded category list.
   */
  function controlByName(form, tagName, name) {
    return form.querySelector(tagName + '[name="' + name + '"]');
  }

  /**
   * Legacy fallback: locate a control by the text of its label.
   */
  function controlByLabel(form, tagName, needles) {
    var groups = form.querySelectorAll('.form-group');
    for (var i = 0; i < groups.length; i++) {
      var label = groups[i].querySelector('label');
      var text = String(label ? label.textContent : '').toLowerCase();
      var hit = needles.some(function (n) { return text.indexOf(n) !== -1; });
      if (!hit) continue;
      var el = groups[i].querySelector(tagName);
      if (el) return el;
    }
    return null;
  }

  /** Localised display names for the catalogue families (values stay English). */
  var CAT_L10N = {
    de: {
      'Pixel & Effects': 'Pixel & Effekte',
      'Theatre Lighting': 'Theaterbeleuchtung',
      'Lasers': 'Laser',
      'Controllers': 'Controller',
      'LED Profile Spot': 'LED-Profilscheinwerfer',
      'Stage Effect Machines': 'Bühneneffektmaschinen',
      'LED Kinetic Winch & Lighting Ball': 'LED Kinetic Winde & Lichtkugel',
      'LED Gobo & Logo Projector Light': 'LED Gobo- & Logo-Projektor',
      'LED Dance Floor Light': 'LED Tanzflächenlicht',
      'Aluminum Truss and Stage': 'Aluminium-Traversen & Bühne'
    },
    es: {
      'Moving Heads': 'Cabezas Móviles',
      'Pixel & Effects': 'Pixel y Efectos',
      'Theatre Lighting': 'Iluminación Teatral',
      'LED PAR & Uplights': 'LED PAR y Uplights',
      'Lasers': 'Láseres',
      'Controllers': 'Controladoras',
      'LED Profile Spot': 'Proyector de Perfil LED',
      'Stage Effect Machines': 'Máquinas de Efectos',
      'LED Kinetic Winch & Lighting Ball': 'Polipasto Cinético LED y Bola de Luz',
      'LED Gobo & Logo Projector Light': 'Proyector Gobo y Logo LED',
      'LED Dance Floor Light': 'Suelo de Baile LED',
      'Aluminum Truss and Stage': 'Estructuras de Aluminio y Escenario'
    }
  };

  var CAT_UI = {
    en: { ph: 'Select category', other: 'Other / Not sure yet' },
    de: { ph: 'Kategorie auswählen', other: 'Sonstiges / Noch unklar' },
    es: { ph: 'Seleccionar categoría', other: 'Otro / Aún no lo sé' }
  };

  function uiLang() {
    var l = String((document.documentElement && document.documentElement.getAttribute('lang')) || 'en');
    l = l.slice(0, 2).toLowerCase();
    return (l === 'de' || l === 'es') ? l : 'en';
  }

  /**
   * Rebuild the category select from the live catalogue taxonomy, in the
   * language of the page. The option *value* is always the canonical English
   * family name so the CRM stays comparable across the three sites.
   */
  function fillCategories(data) {
    var form = document.querySelector('form[data-ajax]');
    if (!form || !data || !data.categories) return null;
    var sel = controlByName(form, 'select', 'category');
    if (!sel) return null;

    var lang = uiLang();
    var dict = CAT_L10N[lang] || {};
    var ui = CAT_UI[lang];
    var chosen = sel.value; // never discard a choice already made

    sel.innerHTML = '';
    var ph = document.createElement('option');
    ph.value = '';
    ph.textContent = ui.ph;
    sel.appendChild(ph);

    Object.keys(data.categories).forEach(function (k) {
      var en = data.categories[k].label || k;
      var o = document.createElement('option');
      o.value = en;
      o.textContent = dict[en] || en;
      sel.appendChild(o);
    });

    var other = document.createElement('option');
    other.value = 'Other / Not sure yet';
    other.textContent = ui.other;
    sel.appendChild(other);

    if (chosen) sel.value = chosen;
    return sel;
  }

  /** Pick the quantity band that contains the basket total. */
  function syncQtySelect(total) {
    var form = document.querySelector('form[data-ajax]');
    if (!form || !total) return;
    var sel = controlByName(form, 'select', 'qty');
    if (!sel || sel.getAttribute('data-user-touched') === '1') return;
    sel.addEventListener('change', function () { sel.setAttribute('data-user-touched', '1'); });

    var chosen = 0;
    for (var i = 1; i < sel.options.length; i++) {
      var m = String(sel.options[i].text).replace(/,/g, '').match(/(\d+)/);
      if (!m) continue;
      if (parseInt(m[1], 10) <= total) chosen = i;
    }
    if (chosen) sel.selectedIndex = chosen;
  }

  function syncCategorySelect(cat, catSelect, data) {
    if (!catSelect || !cat) return;
    if (catSelect.value && catSelect.getAttribute('data-user-touched') === '1') return;
    catSelect.addEventListener('change', function () { catSelect.setAttribute('data-user-touched', '1'); });
    if (!data || !data.categories || !data.categories[cat]) return;
    catSelect.value = data.categories[cat].label || cat;
  }

  /* ---------------------------------------------------------------- rendering */

  function imgCell(it) {
    if (it.image) {
      return '<img src="' + esc(it.image) + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'" />';
    }
    return '<span>◉</span>';
  }

  function renderCart(items) {
    var box = $('cartBox');
    var hint = $('poiHint');
    if (!box) return;

    var badge = $('poiCount');
    if (badge) badge.textContent = String(items.length);

    if (!items.length) {
      box.innerHTML =
        '<div class="qc-empty">No products selected yet — search below to add the fixtures you need, ' +
        'or simply describe your project below for a general enquiry.</div>';
      if (hint) hint.textContent = '';
      document.getElementById('poiPanel').style.display = 'block';
      syncHidden(items, null);
      return;
    }

    box.innerHTML =
      '<div class="qc-head"><span>Product</span><span style="text-align:center">Qty</span><span></span></div>' +
      items.map(function (it) {
        return '<div class="qc-row" data-row="' + esc(it.model) + '">' +
          '<div class="qc-item">' + imgCell(it) +
            '<div class="qc-meta">' +
              '<div class="qc-model">' + esc(it.model) + '</div>' +
              '<div class="qc-name">' + esc(it.name || 'Fixture') + '</div>' +
              (it.price ? '<div class="qc-price">From $' + esc(it.price) + ' / unit</div>' : '') +
            '</div>' +
          '</div>' +
          '<input type="number" min="1" max="99999" step="1" class="qc-qty" value="' + esc(it.qty) +
            '" aria-label="Quantity for ' + esc(it.model) + '" />' +
          '<button type="button" class="qc-del" aria-label="Remove ' + esc(it.model) + '">&times;</button>' +
        '</div>';
      }).join('') +
      '<div class="qc-foot">' + items.length + ' item' + (items.length > 1 ? 's' : '') +
        ' · total ' + CART.totalQty(items) + ' units' +
        ' <button type="button" id="qcClear" class="qc-clear">Clear all</button></div>';

    if (hint) {
      hint.textContent = 'These are the exact products we will quote. Edit quantities freely — they are an estimate, not a commitment.';
    }
    syncHidden(items, null);
  }

  /** Mirror the basket into the fields the backend already understands. */
  function syncHidden(items, data) {
    var first = items[0] || null;
    var set = function (id, v) { var el = $(id); if (el) el.value = v || ''; };
    set('poiItems', JSON.stringify(items.map(function (it) {
      return { model: it.model, name: it.name, qty: it.qty, image: it.image, category: it.category, price: it.price };
    })));
    set('poiSku', first ? first.model : '');
    set('poiName', first ? first.name : '');
    set('poiCat', first ? (CART.dominantCategory(items) || first.category) : '');
    set('poiImgUrl', first ? first.image : '');

    syncQtySelect(CART.totalQty(items));
    if (catSelCache) syncCategorySelect(CART.dominantCategory(items), catSelCache, data || lastData);
  }

  /* ------------------------------------------------------------------ picker */

  var lastData = null;
  var catSelCache = null;

  function renderResults(list, q) {
    var host = $('prodResults');
    if (!host) return;
    q = String(q || '').trim().toLowerCase();
    if (q.length < 2) { host.innerHTML = ''; host.style.display = 'none'; return; }

    var matches = list.filter(function (p) {
      return ((p.model || '') + ' ' + (p.name || '') + ' ' + (p.tagline || '')).toLowerCase().indexOf(q) !== -1;
    }).slice(0, 8);

    if (!matches.length) {
      host.innerHTML = '<div class="qc-res-empty">No match for “' + esc(q) + '”. Spell out the model (e.g. RG-M230BN) or describe it in Project Details.</div>';
      host.style.display = 'block';
      return;
    }

    host.innerHTML = matches.map(function (p) {
      return '<button type="button" class="qc-res" data-pick="' + esc(p.model) + '">' +
        (p.image ? '<img src="' + esc(p.image) + '" alt="" loading="lazy" />' : '<span class="qc-res-ico">◉</span>') +
        '<span class="qc-res-txt"><strong>' + esc(p.model) + '</strong>' +
        '<em>' + esc(String(p.name || '').replace(/^\S+\s*/, '').slice(0, 58)) + '</em></span>' +
        (p.price ? '<span class="qc-res-price">$' + esc(p.price) + '</span>' : '') +
      '</button>';
    }).join('');
    host.style.display = 'block';
  }

  /* -------------------------------------------------------------------- boot */

  function boot() {
    var panel = $('poiPanel');
    if (!panel || !CART) {
      if (panel) panel.style.display = 'none';
      return;
    }
    panel.style.display = 'block';

    // Seed from a legacy deep link (/rfq.html?sku=…). Guarded so a page reload
    // cannot silently inflate the quantity of something already in the basket.
    var params = new URLSearchParams(location.search);
    var seed = params.get('sku') || params.get('product') || params.get('model') || params.get('id') || '';
    var seedGuard = 'sl_qc_seed_' + String(seed).toLowerCase();

    function afterSeed() {
      var items = CART.list();
      renderCart(items);
      if (items.length) {
        var panelEl = $('poiPanel');
        if (panelEl && panelEl.scrollIntoView) {
          // Only scroll when the deep link is what put things in the basket.
          if (seed) panelEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }

    renderCart(CART.list());

    if (seed) {
      try {
        if (sessionStorage.getItem(seedGuard)) { afterSeed(); }
        else if (CART.list().some(function (it) { return it.model.toLowerCase() === String(seed).toLowerCase(); })) {
          sessionStorage.setItem(seedGuard, '1');
          afterSeed();
        } else {
          CART.add(seed, {}).then(function () {
            try { sessionStorage.setItem(seedGuard, '1'); } catch (e) { /* noop */ }
            afterSeed();
          });
        }
      } catch (e) { afterSeed(); }
    }

    window.addEventListener('sl:cart-changed', function (e) {
      renderCart((e.detail && e.detail.items) || CART.list());
    });

    // ---- basket interactions -------------------------------------------
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      var del = t.closest('.qc-del');
      if (del) {
        var row = del.closest('.qc-row');
        if (row) CART.remove(row.getAttribute('data-row'));
        return;
      }
      if (t.id === 'qcClear') { CART.clear(); return; }

      var pick = t.closest('.qc-res');
      if (pick) {
        e.preventDefault();
        CART.add(pick.getAttribute('data-pick'), {}).then(function () {
          var inp = $('prodSearch');
          if (inp) { inp.value = ''; }
          var host = $('prodResults');
          if (host) { host.innerHTML = ''; host.style.display = 'none'; }
        });
        return;
      }
    });

    document.addEventListener('input', function (e) {
      var t = e.target;
      if (!t) return;
      if (t.classList && t.classList.contains('qc-qty')) {
        var row = t.closest('.qc-row');
        if (row) CART.setQty(row.getAttribute('data-row'), t.value);
        return;
      }
      if (t.id === 'prodSearch' && lastData) {
        renderResults(lastData.products, t.value);
      }
    });

    // Close the result list when focus leaves the picker.
    document.addEventListener('focusout', function (e) {
      var host = $('prodResults');
      if (!host) return;
      setTimeout(function () {
        var a = document.activeElement;
        if (a && (a.id === 'prodSearch' || (a.closest && a.closest('#prodResults')))) return;
        host.style.display = 'none';
      }, 120);
    });

    // ---- catalogue enrichment ------------------------------------------
    CART.catalog().then(function (data) {
      if (!data || !data.products) return;
      lastData = data;
      catSelCache = fillCategories(data);
      renderCart(CART.list());
      // Backfill names/images for items added before the catalogue resolved.
      var items = CART.list();
      items.forEach(function (it) {
        if (it.image && it.name) return;
        var p = CART.find(data.products, it.model);
        if (!p) return;
        if (!it.image) it.image = p.image || (p.images && p.images[0]) || '';
        if (!it.name) it.name = p.name || '';
        if (!it.category) it.category = p.category || '';
        if (it.price === null) it.price = p.price === undefined ? null : p.price;
      });
      if (items.length) renderCart(items);
    }).catch(function () { /* offline: the plain form still works */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
