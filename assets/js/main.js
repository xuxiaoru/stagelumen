/* StageLumen — Interactive behaviors (vanilla JS) */
(function () {
  'use strict';

  // Mobile nav
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => nav.classList.toggle('open'));
  }

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
    const href = (a.getAttribute('href') || '').split('#')[0];
    if (href === path) a.classList.add('active');
  });
})();
