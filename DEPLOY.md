# StageLumen — Deployment Guide

Goal: take `demo/` from a local folder to a live, globally-cached, HTTPS-enabled independent site **for $0/month** beyond the domain cost.

> Recommended path: **Cloudflare Pages** (free tier) + **Formspree** (form backend) + **Cloudflare Registrar** (domain).
> Time to live: ~25 minutes (excluding domain approval).

---

## Why This Stack

| Component | Choice | Why |
|-----------|--------|-----|
| Domain | Cloudflare Registrar | Cost price, no markup, free WHOIS privacy |
| DNS + CDN + SSL | Cloudflare | Free tier covers 100% of what we need |
| Hosting | Cloudflare Pages | Static site, global edge, free SSL, 0 ops |
| Form backend | Formspree | Free 50 submissions/month, no server |
| Email | Amazon SES | $0.10 per 1,000 emails, optional |
| Analytics | GA4 + Microsoft Clarity | Free |
| Source control | GitHub + Git | Industry standard |

---

## Pre-Deployment Checklist (do these first)

### 1. Replace placeholders

Open each HTML and replace globally:

| Find | Replace with |
|------|-------------|
| `StageLumen` | your real brand name |
| `stagelumen.com` | your real domain |
| `sales@stagelumen.com` | ✅ 已全站替换为 `sales@rigelighting.com` |
| `privacy@stagelumen.com` | real DPO email |
| `legal@stagelumen.com` | real legal email |
| `+86 138 0000 0000` | real phone / WhatsApp |
| `No. xx Industrial Park Road, Guangzhou` | real address |
| `[Brand X]` (in testimonials) | real reviewer names or remove |

You can do this in VS Code with `Ctrl+Shift+H` for project-wide Find & Replace.

### 2. Update SEO references

- Replace `yourdomain.com` in `sitemap.xml` with your real domain
- Replace `yourdomain.com` in `robots.txt` with your real domain

### 3. (Optional) Configure form backend

For now, RFQ form uses a JavaScript mock. To send real submissions:

1. Sign up at [formspree.io](https://formspree.io) (free tier OK)
2. Create a new form, copy the form ID (`xxxxxxxxxx`)
3. Edit `rfq.html` — find the `<form data-ajax>` and add `action="https://formspree.io/f/xxxxxxxxxx" method="POST"`
4. In `assets/js/main.js`, the form will auto-detect the action and submit for real

---

## Deployment Steps

### Step 1 — Sign up for Cloudflare

1. Visit https://dash.cloudflare.com/sign-up
2. Create account with email + password
3. You do not need to add a site yet (Pages handles this)

### Step 2 — Push code to GitHub

From your local machine, in the `demo/` folder:

```bash
cd demo
git init
git add .
git commit -m "Initial site"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/stagelumen.git
git push -u origin main
```

If you don't have git locally, install from https://git-scm.com.

### Step 3 — Create Cloudflare Pages project

1. In Cloudflare dashboard, click **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
2. Select the GitHub repo you just pushed (`stagelumen`)
3. Build settings:
   - **Framework preset**: None (or "Static HTML")
   - **Build command**: _leave empty_
   - **Build output directory**: `/` (or `.`)
4. Click **Save and Deploy**
5. Cloudflare will give you a temporary URL like `stagelumen.pages.dev` — open it to verify

### Step 4 — Add custom domain

If your domain is already on Cloudflare Registrar:

1. In your Pages project, click **Custom domains** → **Set up a custom domain**
2. Enter `yourdomain.com` and `www.yourdomain.com`
3. Cloudflare auto-creates DNS records + provisions SSL (Free, automatic, takes ~2 minutes)

If your domain is **not** on Cloudflare:

1. Option A: Transfer it to Cloudflare Registrar (free, takes 5-15 minutes for transfer approval)
2. Option B: Keep your current registrar and point nameservers to Cloudflare (change NS records at current registrar)

### Step 5 — Enable SSL

Cloudflare automatically issues and renews SSL certificates once the domain is connected.

1. In Cloudflare dashboard → **SSL/TLS** → set mode to **Full (Strict)**
2. **Edge Certificates** → enable **Always Use HTTPS** (toggle ON)
3. Test: visit `https://yourdomain.com` — you should see the padlock

### Step 6 — Configure performance settings

In Cloudflare dashboard → **Speed** → **Optimization**:

- ✅ Auto Minify: HTML, CSS, JS
- ✅ Brotli
- ✅ Early Hints
- ✅ Rocket Loader (optional, test before keeping)
- ✅ Image Resizing (optional — adds cost)

In **Caching** → **Configuration**:
- Caching Level: Standard
- Browser Cache TTL: 4 hours (Cloudflare overrides our `_headers` settings on cacheable content)

### Step 7 — Connect a form backend

If you skipped "Configure form backend" above:

1. Sign up at https://formspree.io (free tier — 50 submissions/month)
2. Create new form → copy form ID
3. Edit `rfq.html`, find `<form data-ajax>` and replace with:
   ```html
   <form data-ajax action="https://formspree.io/f/YOUR_FORM_ID" method="POST">
   ```
4. Edit `assets/js/main.js` — change `form.action === ''` check to a smarter check based on the URL host
5. Commit + push → Cloudflare auto-deploys in ~30 seconds

### Step 8 — Add analytics

Add these tracking snippets to the `<head>` of every HTML page:

```html
<!-- Google Analytics 4 -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXXXXX');
</script>

<!-- Microsoft Clarity -->
<script type="text/javascript">
  (function(c,l,a,r,i,t,y){
    c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
    t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
    y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
  })(window, document, "script", "clarity", "XXXXXXXXXX");
</script>

<!-- Meta Pixel (Facebook / Instagram) -->
<script>
  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
  n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);
  t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];
  s.parentNode.insertBefore(t,s)}(window, document,'script',
  'https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', 'XXXXXXXXXXXXXXX');
  fbq('track', 'PageView');
</script>
```

Replace the IDs with your real tracking IDs. Commit + push.

### Step 9 — Submit to Google Search Console

1. Visit https://search.google/search-console
2. Add property → Domain
3. Verify via Cloudflare DNS (easiest path) — Cloudflare auto-imports DNS records
4. Submit sitemap: `https://yourdomain.com/sitemap.xml`

### Step 10 — (Optional) Set up email forwarders

For info@, sales@, privacy@ to forward to your Gmail/Outlook:

- Cloudflare free Email Routing works for receiving only
- Forward `sales@yourdomain.com` → your Gmail
- Forward `privacy@yourdomain.com` → your Gmail

---

## Post-Launch Checklist

- [ ] Domain WHOIS privacy is enabled (default on Cloudflare Registrar)
- [ ] HTTPS is enforced (Always Use HTTPS = ON)
- [ ] `https://yourdomain.com` shows padlock
- [ ] Submit sitemap to Google Search Console
- [ ] Submit sitemap to Bing Webmaster Tools
- [ ] Set up email forwarders (info@, sales@, privacy@)
- [ ] Test form submission end-to-end
- [ ] Configure CF _headers / _redirects (already in repo)
- [ ] Lighthouse score ≥ 90 (run on https://pagespeed.web.dev)
- [ ] Mobile-friendly test (https://search.google/test/mobile-friendly)
- [ ] Set custom 404 page (already in repo → `_redirects` or Pages settings)

---

## Cost Summary

| Item | Cost |
|------|------|
| Domain (`.com`) | ~$12/year via Cloudflare Registrar |
| Cloudflare Pages | $0 (free tier — unlimited sites, 500 builds/month) |
| Cloudflare CDN + SSL + DDoS | $0 |
| Formspree free | $0 (50 submissions/month) — pay $8/mo for 1,000 |
| GitHub | $0 |
| **Total** | **~$12/year** + optional form upgrade |

---

## Updating the Site Later

Once deployed, every push to `main` on GitHub automatically triggers a Cloudflare Pages rebuild (~30 seconds). To make changes:

```bash
# Edit files, then:
git add .
git commit -m "Update homepage hero"
git push
# Cloudflare rebuilds automatically
```

You can also preview changes before pushing:
1. Create a branch (`git checkout -b feature/new-product`)
2. Push that branch
3. Cloudflare auto-creates a preview URL like `feature-new-product.stagelumen.pages.dev`

---

## Site Settings Come From The CMS (build-time injection)

`content/settings.yml` is edited in Decap CMS (`/admin` → Site Settings). It is **not**
read by the browser. A build step copies its values into the HTML:

- Script: `build/inject-settings.js`
- Cloudflare Pages → Settings → Builds & deployments → **Build configuration**
  - **Build command:** `node build/inject-settings.js`
  - **Build output directory:** leave empty (publishes the repo root)

**To mark an element as CMS-driven**, add `data-set="<key>"` to its tag:

```html
<a data-set="email" href="mailto:sales@example.com">sales@example.com</a>
<span data-set="phone">+86 000 0000 0000</span>
```

Supported keys: `email`, `phone`, `whatsapp` (URL scheme applied automatically),
plus plain text keys such as `address`, `brand`, `tagline`.

Rules that keep this safe:

- The value already in the HTML is the **fallback**. If `settings.yml` is missing,
  unreadable, or lacks the key, the script exits 0 and leaves the HTML untouched —
  a broken CMS file can never take the site down.
- Editing in the CMS creates a **pull request** (`publish_mode: editorial_workflow`).
  The site only changes **after the PR is merged** and Pages rebuilds.

---

## Common Operations Cheat Sheet

| Need | How |
|------|-----|
| Add a new product | Copy an existing `.html` block in `products.html` |
| Change a brand color | Edit `--primary: #ff6b00` in `style.css` |
| Update contact info | Find/replace `sales@rigelighting.com` across all files（`support@` / `privacy@` / `legal@` 仍为 `stagelumen.com`，需确认后再改） |
| Disable cookie banner | Edit `cookie-consent.js` to auto-dismiss |
| Add a new language | Duplicate folder, change `<html lang="en">` to target lang |
| Enable HTTP/3 | Cloudflare → Network → Enable HTTP/3 (QUIC) |

---

## Trouble Shooting

**Site shows 404 on first visit?**
> Push code again: `git commit --allow-empty -m "trigger rebuild" && git push`

**SSL warning in browser?**
> Cloudflare → SSL → set mode to **Full (Strict)**, not just "Full"

**Form submission not arriving?**
> Check Formspree dashboard; verify form ID is correct in `rfq.html`; check spam folder

**Site is slow in China?**
> Cloudflare Pages is mainly Western edge — for China audience, consider Alibaba Cloud or Tencent Cloud with ICP filing. For 90% Western traffic it's perfect.

**Need a database (cart, login)?**
> Time to migrate to Shopify / BigCommerce / Medusa. Static sites can't host dynamic state.

---

## When to Upgrade Beyond Static

Stay on this stack while:
- ≤ 100,000 monthly visits
- ≤ 1,000 RFQ submissions/month
- Single language (or simple manual translation)

Move up when:
- Adding a real catalog cart (Shopify / BigCommerce)
- Multi-vendor marketplace
- Complex product configurators
- Multi-language with auto-translation
- Heavy dynamic content (user accounts, saved designs)
