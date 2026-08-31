import { ok, fail, optionsResponse, json, CORS_HEADERS } from '../../../_utils/http.js';
import { verifyApiKey, verifyAdmin } from '../../../_utils/auth.js';
import { getProxyService, forwardRequest, proxyCacheKey } from '../../../_utils/proxy.js';
import { getUsage, recordUsage } from '../../../_utils/stats.js';
import { todayCN } from '../../../_utils/http.js';

export const onRequestOptions = () => optionsResponse();

export async function onRequest(context) {
  const { request, env, params, waitUntil } = context;

  const keyAuth = await verifyApiKey(env, request);
  let callerKey = null;
  if (keyAuth.ok) {
    callerKey = keyAuth.key;
  } else {
    const adminAuth = await verifyAdmin(env, request);
    if (!adminAuth.ok) return keyAuth.response;
  }

  const slug = String(params.slug || '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) return fail(40007, 'slug 只能包含小写字母、数字与连字符', 400);

  const service = await getProxyService(env, slug);
  if (!service) return fail(40403, `代理服务「${slug}」不存在`, 404);
  if (service.enabled === false) return fail(40303, `代理服务「${slug}」已被管理员停用`, 403);

  if (callerKey) {
    const { record } = keyAuth;
    const quota = Number(record?.dailyQuota) || 0;
    if (quota > 0) {
      const usage = await getUsage(env, todayCN());
      if ((usage.byKey[callerKey] || 0) >= quota) {
        return fail(42901, `API Key 已达到每日配额（${quota} 次）`, 429);
      }
    }
  }

  const cacheKey = proxyCacheKey(slug, request);
  if (service.cacheTtl > 0 && env.MOONAPI_KV && request.method.toUpperCase() === 'GET') {
    const cached = await env.MOONAPI_KV.get(cacheKey).catch(() => null);
    if (cached) {
      try {
        const payload = JSON.parse(cached);
        if (callerKey) recordUsage(env, waitUntil, callerKey, `proxy:${slug}`);
        return ok(payload.data, { message: 'success (cache)' });
      } catch {}
    }
  }

  let result;
  try {
    result = await forwardRequest(env, service, request);
  } catch (err) {
    if (err?.name === 'AbortError') return fail(50401, '上游接口响应超时', 504);
    return fail(50201, `上游接口请求失败：${err?.message || '未知错误'}`, 502);
  }

  if (callerKey) recordUsage(env, waitUntil, callerKey, `proxy:${slug}`);

  if (result.type === 'binary') {
    return new Response(result.body, {
      status: result.status,
      headers: {
        'content-type': result.contentType,
        'cache-control': service.cacheTtl > 0 ? `public, max-age=${service.cacheTtl}` : 'no-store',
        ...CORS_HEADERS,
      },
    });
  }

  const data = {
    slug,
    name: service.name || slug,
    source: new URL(service.url).host,
    fetchedAt: new Date().toISOString(),
    upstreamStatus: result.status,
    upstream: result.upstream,
  };

  if (service.cacheTtl > 0 && env.MOONAPI_KV && request.method.toUpperCase() === 'GET') {
    waitUntil(
      env.MOONAPI_KV.put(cacheKey, JSON.stringify({ code: 0, data }), {
        expirationTtl: Math.max(60, service.cacheTtl),
      }).catch(() => {})
    );
  }

  return json({ code: 0, message: 'success', data, requestId: crypto.randomUUID() });
}
