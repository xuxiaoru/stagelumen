#!/usr/bin/env python3
"""W3-4 产品页静态化：把 product-detail.html 模板生成 361 个静态页。

用法：
  python build/build-product-pages.py           # 生成到 products/{category}/{id}.html
  python build/build-product-pages.py --one rg-tb140s28d-f60   # 只生成一个（调试）

设计：
  - URL：/products/{category}/{id}（线上 /x.html 会 308 到 /x，故文件名带 .html、
    sitemap/canonical 一律用无扩展名形式）。
  - 静态页是 product-detail.html 的副本，改动点：
      1) <head>：真实 title / meta description / canonical / og / twitter
      2) 静态 Product + BreadcrumbList JSON-LD（data-jsonld="product-static" 等），
         并剥掉模板里的运行时注入 try/catch 块（避免双重 Product 实体）
      3) <body> 开头注入 window.__PRODUCT_ID__ / window.__PRODUCT_URL__，
         模板脚本优先用它取产品（不再依赖 ?id=）
      4) SSR 预填：h1 / 面包屑 / 主图 / 价格 / 交期 / 规格 / 描述 —— 无 JS 爬虫也有实质内容；
         浏览器端 JS 会用同样数据再填一遍，内容一致。
  - 幂等：每次全量重写；--prune 时删除 products/ 下不在当前产品库里的陈旧页面。
  - 产品库更新后重跑本脚本 + `python build/build-seo.py --with-products`。
"""
import json
import os
import re
import sys
import shutil
from html import escape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://www.rigebalighting.com"
TEMPLATE = os.path.join(ROOT, "product-detail.html")
OUTDIR = os.path.join(ROOT, "products")


def load(name):
    with open(os.path.join(ROOT, "data", name), encoding="utf-8") as f:
        return json.load(f)


def jnum(x):
    """JS 风格数字：115.0 -> 115"""
    f = float(x)
    return int(f) if f == int(f) else f


def page_path(p):
    return "products/%s/%s.html" % (p["category"], p["id"])


def page_url(p):
    return "%s/products/%s/%s" % (SITE, p["category"], p["id"])


def build_page(tpl, p):
    cat_label = {
        "moving": "Moving Heads", "pixel": "Pixel & Effects", "theatre": "Theatre Lighting",
        "par": "LED PAR & Uplights", "laser": "Lasers", "controller": "Controllers",
        "profile": "LED Profile Spot",
    }
    url = page_url(p)
    name = p.get("name") or p["id"]
    # title 不拼 tagline：库里 tagline 多为截断文本（如 "Outdoor 360 degree emittin"），
    # name 本身已含型号 + 完整描述，SEO 价值更高
    title = "%s | RiGeBa Lighting" % name
    desc = "%s: %s OEM / ODM ready." % (name, p.get("shortDesc") or name)
    images = (p.get("images") or ([p["image"]] if p.get("image") else []))
    imgs_abs = [u if u.startswith("http") else SITE + "/" + u.lstrip("/") for u in images]
    price = float(p.get("price") or 0)

    # ---------- 静态 JSON-LD ----------
    product_ld = {
        "@context": "https://schema.org",
        "@type": "Product",
        "@id": url + "#product",
        "name": name,
        "brand": {"@type": "Brand", "name": "RiGeBa Lighting"},
        "url": url,
        "description": re.sub(r"\s+", " ", re.sub(r"<[^>]*>", " ", p.get("longDesc") or p.get("shortDesc") or name)).strip()[:500],
    }
    if p.get("model"):
        product_ld["sku"] = p["model"]
        product_ld["mpn"] = p["model"]
    if p.get("category"):
        product_ld["category"] = cat_label.get(p["category"], p["category"])
    if imgs_abs:
        product_ld["image"] = imgs_abs
    if price > 0:
        product_ld["offers"] = {
            "@type": "Offer",
            "url": url,
            "price": jnum(price),
            "priceCurrency": p.get("currency") or "USD",
            "itemCondition": "https://schema.org/NewCondition",
            "availability": "https://schema.org/InStock",
        }
    r, n = float(p.get("rating") or 0), int(p.get("reviews") or 0)
    if r > 0 and n > 0:
        product_ld["aggregateRating"] = {"@type": "AggregateRating", "ratingValue": r, "reviewCount": n}
    specs = [s for s in (p.get("specs") or []) if s.get("label") and s.get("value")][:20]
    if specs:
        product_ld["additionalProperty"] = [
            {"@type": "PropertyValue", "name": s["label"], "value": str(s["value"])} for s in specs
        ]
    crumb_ld = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": SITE + "/"},
            {"@type": "ListItem", "position": 2, "name": "Products", "item": SITE + "/products"},
            {"@type": "ListItem", "position": 3, "name": name, "item": url},
        ],
    }
    def ld_script(obj, kind):
        body = json.dumps(obj, ensure_ascii=False).replace("<", "\\u003c")
        return '<script type="application/ld+json" data-jsonld="%s">%s</script>' % (kind, body)

    # ---------- SSR 预填片段 ----------
    def h(s):
        return escape(str(s or ""), quote=True)

    spec_rows = "\n          ".join(
        '<div class="spec-row"><span class="label">%s</span><span class="value">%s</span></div>'
        % (h(s["label"]), h(s["value"])) for s in (p.get("specs") or [])
    ) or '<div class="loading-placeholder">Specifications on request.</div>'
    full_rows = "\n          ".join(
        '<div class="spec-row"><span class="label">%s</span><span class="value">%s</span></div>'
        % (h(s["label"]), h(s["value"])) for s in (p.get("fullSpecs") or [])
    ) or "<p>No extended specs available.</p>"
    feat_lis = "\n          ".join("<li>%s</li>" % h(f) for f in (p.get("features") or []))
    desc_html = "<h3>%s</h3>\n        <p>%s</p>" % (h(p.get("shortDesc") or name), h(p.get("longDesc") or ""))
    if feat_lis:
        desc_html += '\n        <ul style="margin: 16px 0 0 24px; color: var(--text-2); line-height: 1.9;">\n          %s\n        </ul>' % feat_lis
    price_txt = "$%s" % jnum(price) if price > 0 else "Price on request"
    note_txt = "/ unit (%s, MOQ %s)" % (p.get("incoterm") or "FOB Shenzhen", p.get("moq") or 1)
    lead_txt = "Lead time: %s \u00b7 OEM logo from %s units \u00b7 %s warranty" % (
        p.get("leadTime") or "on request", p.get("oemFrom") or "TBD", p.get("warranty") or "on request")

    src = tpl
    # ---------- 0) <base href="/">：页面在 /products/{cat}/ 深处，
    # 模板里 assets/... 与 *.html 链接全是根相对写法，base 一次修正全部相对引用 ----------
    anchor = '<head>\n'
    assert src.count(anchor) == 1, "head anchor"
    src = src.replace(anchor, '<head>\n  <base href="/" />\n', 1)
    # ---------- 1) head：title / meta / canonical / og ----------
    src = re.sub(r"<title id=\"pageTitle\">.*?</title>",
                 "<title id=\"pageTitle\">%s</title>" % h(title), src, count=1)
    src = re.sub(r"<meta name=\"description\" id=\"pageDescription\" content=\"[^\"]*\" />",
                 "<meta name=\"description\" id=\"pageDescription\" content=\"%s\" />" % h(desc), src, count=1)
    head_extra = (
        '  <link rel="canonical" href="%s" />\n'
        '  <meta property="og:type" content="product" />\n'
        '  <meta property="og:site_name" content="RiGeBa Lighting" />\n'
        '  <meta property="og:title" content="%s" />\n'
        '  <meta property="og:description" content="%s" />\n'
        '  <meta property="og:url" content="%s" />\n'
        '  <meta name="twitter:card" content="summary_large_image" />\n'
        '  <meta name="twitter:title" content="%s" />\n'
        '  <meta name="twitter:description" content="%s" />\n'
        % (h(url), h(title), h(desc), h(url), h(title), h(desc))
    )
    if imgs_abs:
        head_extra += (
            '  <meta property="og:image" content="%s" />\n'
            '  <meta property="og:image:alt" content="%s" />\n'
            '  <meta name="twitter:image" content="%s" />\n' % (h(imgs_abs[0]), h(name), h(imgs_abs[0]))
        )
    head_extra += "  " + ld_script(product_ld, "product-static") + "\n  " + ld_script(crumb_ld, "breadcrumb-static") + "\n"
    anchor = '  <link rel="stylesheet" href="assets/css/style.css'
    assert src.count(anchor) == 1, "stylesheet anchor"
    src = src.replace(anchor, head_extra + anchor, 1)

    # ---------- 2) 剥掉运行时 JSON-LD try/catch（静态页用静态块） ----------
    m = re.search(r"\n    // 1b\. 结构化数据[\s\S]*?\n    \} catch \(e\) \{[^}]*\}", src)
    if not m:
        m = re.search(r"\n    // 1b\. 结构化数据[\s\S]*?\n    \} catch \(e\)[^\n]*", src)
    assert m, "runtime jsonld block not found"
    src = src[:m.start()] + "\n" + src[m.end():]

    # ---------- 3) body 开头注入全局 ID ----------
    glob = ('<script>window.__PRODUCT_ID__=%s;window.__PRODUCT_URL__="/products/%s/%s";</script>\n'
            % (json.dumps(p["id"]), p["category"], p["id"]))
    anchor = "<body>\n"
    assert src.count(anchor) == 1, "body anchor"
    src = src.replace(anchor, "<body>\n" + glob, 1)

    # ---------- 4) SSR 预填 ----------
    subs = [
        ('<h1 id="productName">Loading…</h1>', '<h1 id="productName">%s</h1>' % h(name)),
        ('<span id="breadcrumbName">Loading…</span>', '<span id="breadcrumbName">%s</span>' % h(name)),
        ('<img src="" alt="" id="galleryMainImg" class="gallery-main-img" />',
         '<img src="%s" alt="%s" id="galleryMainImg" class="gallery-main-img" />'
         % (h(imgs_abs[0]) if imgs_abs else "", h(name))),
        ('<span id="productPrice">$—</span>', '<span id="productPrice">%s</span>' % h(price_txt)),
        ('<small id="productPriceNote">/ unit (FOB Shenzhen)</small>',
         '<small id="productPriceNote">%s</small>' % h(note_txt)),
        ("Lead time: Loading…", h(lead_txt)),
        ('<div class="spec-list" id="specList">\n          <div class="loading-placeholder">Loading specifications…</div>\n        </div>',
         '<div class="spec-list" id="specList">\n          %s\n        </div>' % spec_rows),
        ('<div class="spec-list" id="fullSpecList">\n          <div class="loading-placeholder">Loading full specs…</div>\n        </div>',
         '<div class="spec-list" id="fullSpecList">\n          %s\n        </div>' % full_rows),
        ('<div class="tab-panel active" data-panel="desc" id="descPanel">\n        <div class="loading-placeholder">Loading description…</div>\n      </div>',
         '<div class="tab-panel active" data-panel="desc" id="descPanel">\n        %s\n      </div>' % desc_html),
    ]
    for old, new in subs:
        assert src.count(old) == 1, "SSR anchor not unique: %s" % old[:60]
        src = src.replace(old, new)
    return src


def main():
    one = None
    prune = False
    for a in sys.argv[1:]:
        if a == "--prune":
            prune = True
        elif a.startswith("--one"):
            one = a.split("=", 1)[1] if "=" in a else None
            if not one and len(sys.argv) > sys.argv.index(a) + 1:
                one = sys.argv[sys.argv.index(a) + 1]

    with open(TEMPLATE, encoding="utf-8") as f:
        tpl = f.read()
    data = load("products.json")
    products = data["products"]
    if one:
        products = [p for p in products if p["id"] == one]
        assert products, "product not found: %s" % one

    written = 0
    for p in products:
        assert p.get("category") and p.get("id"), p
        out = os.path.join(ROOT, page_path(p).replace("/", os.sep))
        os.makedirs(os.path.dirname(out), exist_ok=True)
        html = build_page(tpl, p)
        with open(out, "w", encoding="utf-8", newline="\n") as f:
            f.write(html)
        written += 1

    removed = 0
    if prune and not one:
        valid = {page_path(p).replace("/", os.sep) for p in data["products"]}
        for dirpath, _dirs, files in os.walk(OUTDIR):
            for fn in files:
                full = os.path.join(dirpath, fn)
                rel = os.path.relpath(full, ROOT)
                if rel not in valid:
                    os.remove(full)
                    removed += 1
        for dirpath, dirs, files in os.walk(OUTDIR, topdown=False):
            if not os.listdir(dirpath):
                os.rmdir(dirpath)

    print("written %d pages -> %s" % (written, os.path.relpath(OUTDIR, ROOT)))
    if removed:
        print("pruned %d stale pages" % removed)
    total = len(data["products"])
    print("catalog total = %d" % total)


if __name__ == "__main__":
    main()
