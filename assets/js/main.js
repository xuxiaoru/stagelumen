/* StageLumen — Interactive behaviors (vanilla JS) */
(function () {
  'use strict';

  const dropdowns = Array.prototype.slice.call(document.querySelectorAll('.nav-dropdown'));
  let dropdownTimer = null;

  function closeDropdowns(except) {
    dropdowns.forEach((d) => {
      if (d !== except) d.classList.remove('is-open', 'open');
    });
  }

  // Desktop: JS 控制 + 220ms 关闭延迟，鼠标从主菜单移到下拉时不会闪断
  dropdowns.forEach((dd) => {
    dd.addEventListener('mouseenter', () => {
      clearTimeout(dropdownTimer);
      if (window.innerWidth <= 960) return;
      closeDropdowns(dd);
      dd.classList.add('is-open');
    });
    dd.addEventListener('mouseleave', () => {
      if (window.innerWidth <= 960) return;
      clearTimeout(dropdownTimer);
      dropdownTimer = setTimeout(() => dd.classList.remove('is-open'), 220);
    });

    // Mobile: 点击展开/收起（JS 绑定，避免依赖 href 结构）
    const trigger = dd.querySelector(':scope > a');
    if (trigger) {
      trigger.addEventListener('click', (e) => {
        if (window.innerWidth > 960) return;
        e.preventDefault();
        const wasOpen = dd.classList.contains('open') || dd.classList.contains('is-open');
        closeDropdowns();
        if (!wasOpen) dd.classList.add('open', 'is-open');
      });
    }
  });

  // Mobile nav
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => nav.classList.toggle('open'));
    // Close mobile nav when a plain link is clicked
    nav.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        const parent = link.closest('.nav-dropdown');
        if (!parent) {
          nav.classList.remove('open');
          closeDropdowns();
        }
      });
    });
  }
  // Close mobile nav on resize to desktop
  window.addEventListener('resize', () => {
    if (window.innerWidth > 960 && nav) {
      nav.classList.remove('open');
      closeDropdowns();
    }
  });
  // Close mobile nav on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav) {
      nav.classList.remove('open');
      closeDropdowns();
    }
  });

  // Tabs
  document.querySelectorAll('[data-tabset]').forEach((set) => {
    const buttons = set.querySelectorAll('[data-tab]');
    const panels = set.querySelectorAll('[data-panel]');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        buttons.forEach((b) => b.classList.remove('active'));
        panels.forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        const target = set.querySelector(`[data-panel="${btn.dataset.tab}"]`);
        if (target) target.classList.add('active');
      });
    });
  });

  // Product gallery thumbs
  document.querySelectorAll('[data-gallery]').forEach((gallery) => {
    const main = gallery.querySelector('[data-main]');
    const thumbs = gallery.querySelectorAll('[data-thumb]');
    thumbs.forEach((thumb) => {
      thumb.addEventListener('click', () => {
        thumbs.forEach((t) => t.classList.remove('active'));
        thumb.classList.add('active');
        if (main) {
          const icon = thumb.dataset.icon;
          const color = thumb.dataset.color;
          main.dataset.icon = icon;
          main.dataset.color = color;
          const span = main.querySelector('.icon');
          if (span && icon) {
            span.textContent = icon;
            span.style.color = color || '#ff6b00';
          }
        }
      });
    });
  });

  // Product list filter
  document.querySelectorAll('[data-filter-group]').forEach((group) => {
    const buttons = group.querySelectorAll('[data-filter]');
    const targetSelector = group.dataset.filterGroup;
    const target = document.querySelector(targetSelector);
    if (!target) return;
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        buttons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const filter = btn.dataset.filter;
        target.querySelectorAll('[data-cat]').forEach((card) => {
          const cat = card.dataset.cat;
          card.style.display = (filter === 'all' || cat === filter) ? '' : 'none';
        });
      });
    });
  });

  // Product sort
  const sortSelect = document.getElementById('productSort');
  if (sortSelect && typeof StageLumenProducts !== 'undefined') {
    sortSelect.addEventListener('change', () => {
      const activeBtn = document.querySelector('#productToolbar [data-filter].active');
      const filter = activeBtn ? activeBtn.dataset.filter : 'all';
      StageLumenProducts.renderGrid('productGrid', filter, sortSelect.value);
    });
  }

  // Qty stepper
  document.querySelectorAll('.qty-stepper').forEach((stepper) => {
    const input = stepper.querySelector('input');
    const minus = stepper.querySelector('[data-step="-1"]');
    const plus = stepper.querySelector('[data-step="1"]');
    if (minus && input) {
      minus.addEventListener('click', () => {
        input.value = Math.max(1, parseInt(input.value || '1', 10) - 1);
      });
    }
    if (plus && input) {
      plus.addEventListener('click', () => {
        input.value = parseInt(input.value || '1', 10) + 1;
      });
    }
  });

  // Form submit (mock)
  document.querySelectorAll('form[data-ajax]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const status = form.querySelector('[data-status]');
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      if (status) {
        status.textContent = 'Submitting your request…';
        status.className = 'form-status loading';
      }
      setTimeout(() => {
        if (status) {
          status.textContent = '✓ Thanks! Our team will get back to you within 24 hours.';
          status.className = 'form-status success';
        }
        form.reset();
        if (submitBtn) submitBtn.disabled = false;
        setTimeout(() => {
          if (status) {
            status.textContent = '';
            status.className = 'form-status';
          }
        }, 6000);
      }, 1000);
    });
  });

  // Newsletter (mock)
  document.querySelectorAll('.newsletter').forEach((box) => {
    const btn = box.querySelector('button');
    const input = box.querySelector('input');
    if (!btn || !input) return;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (!input.value) {
        input.placeholder = 'Please enter your email';
        input.style.borderColor = '#ff6b00';
        setTimeout(() => {
          input.placeholder = 'Get product updates…';
          input.style.borderColor = '';
        }, 2000);
        return;
      }
      const original = btn.textContent;
      btn.textContent = '✓ Subscribed';
      btn.style.background = '#10b981';
      input.value = '';
      setTimeout(() => {
        btn.textContent = original;
        btn.style.background = '';
      }, 2500);
    });
  });

  // Fade-in observer
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08 });
    document.querySelectorAll('.fade-up').forEach((el) => observer.observe(el));
  } else {
    document.querySelectorAll('.fade-up').forEach((el) => el.classList.add('in-view'));
  }

  // Active nav link by current page
  const path = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav a').forEach((a) => {
    const href = (a.getAttribute('href') || '').split('#')[0].split('?')[0];
    if (href === path) {
      a.classList.add('active');
      // If the active link is inside a dropdown, also mark the trigger
      const dropdown = a.closest('.nav-dropdown');
      if (dropdown) {
        const trigger = dropdown.querySelector(':scope > a');
        if (trigger) trigger.classList.add('active');
      }
    }
  });

  // Case study filter (projects page)
  const caseFilterGroup = document.querySelector('.filter-bar');
  const caseGrid = document.getElementById('caseGrid');
  if (caseFilterGroup && caseGrid) {
    caseFilterGroup.querySelectorAll('[data-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        caseFilterGroup.querySelectorAll('[data-filter]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const filter = btn.dataset.filter;
        caseGrid.querySelectorAll('[data-type]').forEach((card) => {
          card.style.display = (filter === 'all' || card.dataset.type === filter) ? '' : 'none';
        });
      });
    });
  }

  // URL-based product filter（products.html 有自己的初始化逻辑，避免重复渲染）
  const urlParams = new URLSearchParams(window.location.search);
  const catFilter = urlParams.get('cat');
  if (catFilter && typeof StageLumenProducts !== 'undefined' && !document.getElementById('subToolbar')) {
    const toolbar = document.getElementById('productToolbar');
    if (toolbar) {
      toolbar.querySelectorAll('[data-filter]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.filter === catFilter);
      });
      StageLumenProducts.renderGrid('productGrid', catFilter).then(() => {
        document.querySelectorAll('.product-card').forEach((el) => el.classList.add('in-view'));
      });
    }
  }
})();
