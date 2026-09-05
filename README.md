# StageLumen Demo — Stage Lighting Foreign Trade Independent Site

A standalone, self-contained HTML demo for a B2B stage-lighting foreign-trade independent site, built from scratch with vanilla HTML, CSS and JavaScript — no build tools, no external dependencies.

## How to Preview

1. Open the folder `demo/` in your file explorer.
2. Double-click `index.html` to open it in your default browser.

Or open directly:

```
demo/index.html
```

> All assets (CSS / JS) are relative paths and the site uses system fonts only — works fully offline after download.

## Pages Included

| Path | Description |
|------|-------------|
| `index.html` | Homepage — hero, trust bar, categories, featured products, applications, why-us, certifications, testimonials, RFQ CTA |
| `products.html` | Product list with category filters, sort dropdown, and pagination |
| `product-detail.html` | Product detail page — gallery, specs, qty stepper, tabs (Description / Specs / Downloads / Applications / Reviews / FAQ), related products |
| `rfq.html` | Full B2B RFQ form — quantity, application, country, budget, lead time, trade terms + sales contact card + sales process |
| `about.html` | About Us — factory showcase, capabilities stats, certifications, 15-year timeline, cooperation process |
| `assets/css/style.css` | Shared design system (dark theme + orange/cyan/purple accents, fully responsive) |
| `assets/js/main.js` | Interactions — mobile nav, tabs, gallery, filters, qty stepper, form AJAX mock, fade-in scroll, newsletter mock |

## Design System Snapshot

- **Brand**: StageLumen ("S" mark + gradient orange→purple→cyan)
- **Slogan**: Light Up Every Stage
- **Theme**: Dark `#0a0a0a` base, primary `#ff6b00` (orange), accents cyan `#00d4ff` / violet `#7c3aed`
- **Typography**: System font stack (no remote fonts)
- **Layout**: 1280px container, 4-col product grid, responsive down to mobile

## Features Interactive in the Demo

- Mobile hamburger menu
- Product category filter pills (click to filter)
- Product detail thumbnail gallery (click swaps main image)
- Tabs on product detail (Description / Specs / Downloads / Applications / Reviews / FAQ)
- Quantity stepper on product detail
- Mock RFQ form submission (resets after success message)
- Mock newsletter subscription (writes back ✓ Subscribed)
- Fade-up on scroll for cards

## Before Going Live — Production Checklist

This is a **design + UX demo**. To turn it into a real production site:

- [ ] Replace placeholder brand "StageLumen" with your real brand name and logo
- [ ] Replace all phone / email / address placeholders
- [ ] Replace `[Brand X]` and similar placeholders in reviews / hero text
- [ ] Add a real SSL certificate + custom domain
- [ ] Wire up form backend (Formspree, Getform, custom API, or HubSpot / Marketo)
- [ ] Integrate live chat (Tidio / Crisp / Intercom)
- [ ] Add GA4 + Microsoft Clarity + Meta Pixel
- [ ] Add real product photos (high-res stages, renderings, IES-mapped shots)
- [ ] Translate to additional languages (DE / FR / ES / JA)
- [ ] Connect to a CMS (Shopify, BigCommerce, or Magento) or sanity.io for content
- [ ] Set up DMX / IES / spec-sheet file hosting in `assets/downloads/`

## Recommended Tech Upgrades

When ready to ship:

- **E-commerce**: Shopify Plus (best for B2B + SEO), BigCommerce, or Magento Open Source.
- **CMS**: Strapi / Sanity for blog and resource library.
- **Hosting**: Vercel / Netlify if staying static, or Cloudflare + Shopify for full stack.
- **Email**: Klaviyo / Mailchimp for EDM automation.
- **Live chat**: Tidio (multi-language).
- **SEO**: Ahrefs / SEMrush keyword tracking; Surfer SEO for content briefs.

## File Map

```
demo/
├── README.md
├── index.html                # Homepage (entry point)
├── products.html             # Product list + filter + pagination
├── product-detail.html       # Product detail page
├── rfq.html                  # B2B inquiry form
├── about.html                # Factory + company
└── assets/
    ├── css/
    │   └── style.css         # Complete design system
    └── js/
        └── main.js           # All interactions
```

---

Built as a starting point for your stage-lighting foreign-trade independent site strategy discussed in the project plan.
