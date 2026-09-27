/**
 * GET  /api/indexnow  -> 就绪自检：key、keyLocation，以及线上 key 文件是否真的可读且一致
 * POST /api/indexnow  -> 提交 URL（仅管理员）
 *      body { "urls": ["https://..."] }     指定 URL
 *      body { "sitemap": true }             全量播种（读 sitemap.xml + sitemap-products.xml）
 *      body { "sitemap": true, "urls": [...] }  两者合并
 *
 * 用途：除了每日博文会自动 ping，做大批量改动（产品导入、改版）之后也应该
 * 手动 POST 一次，让 Bing 立刻重爬，而不是等它自己发现。
 */
import { ok, json, fail, handleOptions, adminAuthorized, readBody } from '../_lib/util.js';
import { INDEXNOW_KEY, INDEXNOW_HOST, keyLocation, submitUrls, collectSitemapUrls } from '../_lib/indexnow.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return handleOptions();

  if (!adminAuthorized(request, env)) {
    return fail(env.ADMIN_TOKEN ? 'Unauthorized' : 'ADMIN_TOKEN is not configured', 401);
  }

  if (request.method === 'GET') {
    let keyFile;
    try {
      const r = await fetch(keyLocation(), { cf: { cacheTtl: 60 } });
      const body = (await r.text()).trim();
      keyFile = { ok: r.ok, status: r.status, matchesKey: body === INDEXNOW_KEY, head: body.slice(0, 64) };
    } catch (e) {
      keyFile = { ok: false, error: e && e.message ? e.message : String(e) };
    }
    return ok({
      key: INDEXNOW_KEY,
      host: INDEXNOW_HOST,
      keyLocation: keyLocation(),
      keyFile,
      ready: !!(keyFile && keyFile.ok && keyFile.matchesKey),
    });
  }

  if (request.method !== 'POST') return fail('Method not allowed', 405);

  let body;
  try {
    body = await readBody(request);
  } catch (e) {
    return fail('Invalid JSON body', 400);
  }

  let urls = Array.isArray(body.urls) ? body.urls.slice() : [];
  if (body.sitemap) {
    urls = urls.concat(await collectSitemapUrls());
  }
  if (!urls.length) {
    return fail('nothing to submit: pass {"urls":[...]} or {"sitemap":true}', 422);
  }

  const res = await submitUrls(urls);
  return json(res, res.ok ? 200 : 502);
}
