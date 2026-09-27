/**
 * IndexNow 提交（Bing / Yandex / Seznam / Naver / Yep 等共用协议）。
 *
 * key 是**公开**的，不是密钥：它必须原样放在
 *   https://www.rigebalighting.com/<INDEXNOW_KEY>.txt
 * 供搜索引擎确认我们拥有该主机。**下面这个常量与仓库根目录的
 * `<KEY>.txt` 文件名必须完全一致** —— GET /api/indexnow 会在线上实时
 * 回读该文件并比对，不一致会直接暴露，而不是静默失败。
 *
 * 为什么值得做：本站在 Cloudflare Pages 上，除了 sitemap 之外没有任何
 * 主动推送机制，新文章只能等 Bing 自己爬（几天到几周）。IndexNow 是
 * 一次 POST 就通知到位，且 DuckDuckGo 的传统链接大量来自 Bing。
 */
export const INDEXNOW_KEY = 'c2fc5c421c4bfcc380a51db243e46071';
export const INDEXNOW_HOST = 'www.rigebalighting.com';

const ENDPOINT = 'https://api.indexnow.org/indexnow';
const MAX_URLS = 10000;

export const keyLocation = () =>
  'https://' + INDEXNOW_HOST + '/' + INDEXNOW_KEY + '.txt';

/**
 * 只保留同源 https URL 并去重 —— IndexNow 只要有一条不属于 host 的 URL
 * 就会整批 400，宁可本地先筛掉。
 */
export function normalizeUrls(input) {
  const out = [];
  const seen = new Set();
  const prefix = 'https://' + INDEXNOW_HOST + '/';
  for (const raw of Array.isArray(input) ? input : []) {
    let u = String(raw || '').trim();
    if (!u) continue;
    if (u.startsWith('/')) u = 'https://' + INDEXNOW_HOST + u;
    if (!u.startsWith(prefix)) continue;
    u = u.split('#')[0];
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out.slice(0, MAX_URLS);
}

/** 提交一批 URL。200 = 收下；202 = 收下但 key 还在校验中。 */
export async function submitUrls(urls) {
  const list = normalizeUrls(urls);
  if (!list.length) return { ok: false, error: 'no same-host urls to submit', submitted: 0 };
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: INDEXNOW_HOST,
        key: INDEXNOW_KEY,
        keyLocation: keyLocation(),
        urlList: list,
      }),
    });
  } catch (e) {
    return { ok: false, error: 'fetch failed: ' + (e && e.message ? e.message : String(e)), submitted: 0 };
  }
  return {
    ok: res.status === 200 || res.status === 202,
    status: res.status,
    submitted: list.length,
    urls: list,
  };
}

/** 从本站 sitemap 收集全部 URL（含产品 sitemap），用于首次全量播种。 */
export async function collectSitemapUrls() {
  const out = [];
  for (const name of ['sitemap.xml', 'sitemap-products.xml']) {
    try {
      const r = await fetch('https://' + INDEXNOW_HOST + '/' + name);
      const xml = await r.text();
      for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) out.push(m[1]);
    } catch (e) {
      /* 单个 sitemap 失败不影响另一个 */
    }
  }
  return out;
}
