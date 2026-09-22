#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Day-1 域名止血：把站点里所有 stagelumen.pages.dev（预览域）换成正式域名，并修错 canonical。

背景：诊断报告 P0 #0 —— 首页 canonical 指向预览域，等于告诉 Google「别索引正式站」。
预览域公开可访问，若不统一，正式站会被判定为重复舞。

用法： python build/_day1_domain_patch.py      （cwd = demo 根）
每个锚点先断言 count==1（资源页/法律页各 1 处），换行原样保留（仓库混 CRLF/LF）。
"""
import os, sys

SITE = "https://www.rigebalighting.com"
OLD = "https://stagelumen.pages.dev"
ROOTOOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

EDITS = [
    # 1. 博客生成器：决定 13 篇博客的 canonical / og:image 绝对地址
    ("build/build-blog.js",
     "const SITE = '%s';" % OLD,
     "const SITE = '%s';" % SITE),

    # 2. 首页 canonical（P0 #0，致命）
    ("index.html",
     '<link rel="canonical" href="%s/" />' % OLD,
     '<link rel="canonical" href="%s/" />' % SITE),
    ("home-v2.html",
     '<link rel="canonical" href="%s/" />' % OLD,
     '<link rel="canonical" href="%s/" />' % SITE),

    # 3. resources.html 原来 canonical 指向 support.html —— 顺手修成自己
    ("resources.html",
     '<link rel="canonical" href="%s/support.html" />' % OLD,
     '<link rel="canonical" href="%s/resources" />' % SITE),

    # 4. 法律页提到的站点域名
    ("privacy.html",
     "operates the website <em>stagelumen.pages.dev</em>",
     "operates the website <em>www.rigebalighting.com</em>"),
    ("terms.html",
     "By accessing this website (stagelumen.pages.dev)",
     "By accessing this website (www.rigebalighting.com)"),

    # 5. CMS 配置
    ("admin/config.yml",
     "base_url: %s" % OLD,
     "base_url: %s" % SITE),
    ("admin/config.yml",
     "site_url: %s" % OLD,
     "site_url: %s" % SITE),
    ("admin/config.yml",
     "display_url: %s" % OLD,
     "display_url: %s" % SITE),
    ("admin/config.yml",
     "logo_url: %s/assets/images/logo.png" % OLD,
     "logo_url: %s/assets/images/logo.png" % SITE),

    # 6. 发给客户的邮件签名 / 内容工厂产出里写的站点地址
    ("functions/_lib/notify.js",
     "  'stagelumen.pages.dev',",
     "  'www.rigebalighting.com',"),
    ("functions/api/content.js",
     "out.published = '%s/content/blog/' + res.slug + '.html';" % OLD,
     "out.published = '%s/content/blog/' + res.slug;" % SITE),
]


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # .../demo
    # 每个文件只允许写一次 → 先算好所有替换再落盘
    pending = {}
    for rel, old, new in EDITS:
        p = os.path.join(root, rel)
        if not os.path.exists(p):
            print("  SKIP 文件不存在:", rel)
            continue
        if rel not in pending:
            pending[rel] = [open(p, encoding="utf-8", newline="").read(), []]
        pending[rel][1].append((old, new))

    for rel, (src, pairs) in pending.items():
        for old, new in pairs:
            n = src.count(old)
            if n != 1:
                print("  FAIL 锚点命中 %d 次（应为 1）：%s :: %s" % (n, rel, old[:70]))
                sys.exit(1)
            src = src.replace(old, new)
        with open(os.path.join(root, rel), "w", encoding="utf-8", newline="") as f:
            f.write(src)
        print("  OK   %-28s %d 处替换" % (rel, len(pairs)))


if __name__ == "__main__":
    main()
