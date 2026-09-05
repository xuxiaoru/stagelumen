// =====================================================
// StageLumen 产品数据加载与渲染
// =====================================================

const PRODUCT_DATA_URL = 'data/products.json';

let productCache = null;

async function loadProducts() {
  if (productCache) return productCache;
  const r = await fetch(PRODUCT_DATA_URL, { cache: 'no-cache' });
  if (!r.ok) throw new Error('Failed to load products.json');
  productCache = await r.json();
  return productCache;
}

// 渲染星级
function renderStars(rating) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  let s = '★'.repeat(full);
  if (half) s += '½';
  s += '☆'.repeat(5 - full - (half ? 1 : 0));
  return `<span class="product-rating">${s}</span>`;
}

// 渲染徽章
function renderBadge(badge) {
  if (!badge) return '';
  const cls = badge.toLowerCase() === 'kit' ? 'kit' : badge.toLowerCase();
  return `<span class="product-badge ${cls}">${badge}</span>`;
}

// 单个产品卡片 HTML
function renderProductCard(p, cats) {
  const catLabel = cats[p.category] ? cats[p.category].label : p.category;
  return `
    <a href="product-detail.html?id=${p.id}" class="product-card" data-cat="${p.category}" data-id="${p.id}">
      <div class="product-thumb">
        ${renderBadge(p.badge)}
        <span class="product-thumb-icon" style="color:${p.iconColor || '#ff6b00'}">${p.icon || '◉'}</span>
      </div>
      <div class="product-info">
        <h4>${p.name}</h4>
        <div class="product-meta">
          <span>${p.tagline}</span>
          ${renderStars(p.rating || 5)}
        </div>
        <div class="product-price">From <strong>$${p.price}</strong></div>
        <div class="product-actions">
          <span class="btn btn-ghost">Details</span>
          <span class="btn btn-primary">Quote</span>
        </div>
      </div>
    </a>
  `;
}

// 渲染完整产品列表（用于 products.html）
async function renderProductGrid(targetId = 'productGrid', filter = 'all', sort = 'featured') {
  const grid = document.getElementById(targetId);
  if (!grid) return;
  const data = await loadProducts();
  let list = [...data.products];

  if (filter && filter !== 'all') list = list.filter(p => p.category === filter);

  switch (sort) {
    case 'price-asc':  list.sort((a, b) => a.price - b.price); break;
    case 'price-desc': list.sort((a, b) => b.price - a.price); break;
    case 'newest':     list.sort((a, b) => (b.badge === 'new' ? 1 : 0) - (a.badge === 'new' ? 1 : 0)); break;
    case 'popular':    list.sort((a, b) => parseInt((b.sold || '0').replace(/[^0-9]/g, '')) - parseInt((a.sold || '0').replace(/[^0-9]/g, ''))); break;
    default: /* featured — 保留原顺序 */
  }

  grid.innerHTML = list.map(p => renderProductCard(p, data.categories)).join('') ||
    '<p style="text-align:center; padding:60px 20px; color:#888;">No products match this filter.</p>';
}

// 渲染首页 Best Sellers（取前 8）
async function renderBestSellers(targetId = 'bestSellers') {
  const grid = document.getElementById(targetId);
  if (!grid) return;
  const data = await loadProducts();
  const list = data.products.slice(0, 8);
  grid.innerHTML = list.map(p => renderProductCard(p, data.categories)).join('');
}

// 渲染 Related Products（详情页用，排除自己）
async function renderRelatedProducts(targetId, excludeId, limit = 4) {
  const grid = document.getElementById(targetId);
  if (!grid) return;
  const data = await loadProducts();
  const list = data.products.filter(p => p.id !== excludeId).slice(0, limit);
  grid.innerHTML = list.map(p => renderProductCard(p, data.categories)).join('');
}

// 取单个产品
async function getProduct(id) {
  const data = await loadProducts();
  return data.products.find(p => p.id === id);
}

// 全局暴露
window.StageLumenProducts = {
  load: loadProducts,
  renderGrid: renderProductGrid,
  renderBestSellers,
  renderRelated: renderRelatedProducts,
  get: getProduct,
  renderCard: renderProductCard,
  renderStars,
  renderBadge
};
