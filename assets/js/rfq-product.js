/**
 * StageLumen — RFQ product prefill
 *
 * When a visitor arrives from a product page (product-detail.html?product=<id>
 * or rfq.html?sku=/?product=/?model=/?id=), we look the product up in
 * data/products.json and prefill the editable "Product of Interest" panel so
 * the sales team receives exactly which product the quote is about.
 *
 * Every field is a normal <input>, so the visitor can correct anything before
 * submitting. Nothing here blocks submission if the lookup fails.
 */
(function () {
  'use strict';

  function qp(name) {
    return new URLSearchParams(location.search).get(name);
  }

  function findProduct(list, key) {
    key = (key || '').trim().toLowerCase();
    if (!key) return null;
    // exact match on model or id first
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p.model && p.model.toLowerCase() === key) return p;
      if (p.id && p.id.toLowerCase() === key) return p;
    }
    // loose match (e.g. "RG-M230" inside a longer model)
    for (var j = 0; j < list.length; j++) {
      var q = list[j];
      var hay = ((q.model || '') + ' ' + (q.id || '')).toLowerCase();
      if (hay.indexOf(key) !== -1) return q;
    }
    return null;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var panel = document.getElementById('poiPanel');
    if (!panel) return;

    var sku = qp('sku') || qp('product') || qp('model') || qp('id') || '';
    var label = document.getElementById('poiLabel');
    var hint = document.getElementById('poiHint');

    // No product context → keep the panel hidden, plain general inquiry.
    if (!sku) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = 'block';

    var skuEl = document.getElementById('poiSku');
    var nameEl = document.getElementById('poiName');
    var catEl = document.getElementById('poiCat');
    var imgEl = document.getElementById('poiImg');
    var imgUrlEl = document.getElementById('poiImgUrl');

    skuEl.value = sku;

    // Resolve the friendly name / image from the catalogue.
    fetch('data/products.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var list = (d && d.products) || [];
        var p = findProduct(list, sku);
        if (p) {
          nameEl.value = p.name || p.title || p.model || '';
          catEl.value = p.category || '';
          var img = p.image || (p.images && p.images[0]) || '';
          imgUrlEl.value = img || '';
          if (img) {
            imgEl.src = img;
            imgEl.style.display = 'block';
          }
          if (hint) hint.textContent = 'Prefilled from the product page — edit any field if it looks off.';
        } else if (hint) {
          hint.textContent = 'We could not auto-match "' + sku + '" in our catalogue — please verify or correct the model.';
        }
      })
      .catch(function () {
        if (hint) hint.textContent = 'Could not load the catalogue — please verify the model manually.';
      });
  });
})();
