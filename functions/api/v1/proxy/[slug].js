// GET/POST /api/v1/proxy/{slug} —— 代理转发（API Key 或管理员令牌认证）
// 全链路阶段计时并写入调用日志（logs/{date}/…），阶段：认证 → 服务解析 → 配额检查 → 缓存 → 上游转发 → 响应封装
import { ok, fail, optionsResponse, json, CORS_HEADERS, todayCN } from '../../../_utils/http.js';
import { verifyApiKey, verifyAdmin } from '../../../_utils/auth.js';
import { getProxyService, forwardRequest, proxyCacheKey } from '../../../_utils/proxy.js';
import { getUsage, recordUsage } from '../../../_utils/stats.js';
import { newCallEntry, setStage, writeCallLog, maskKeyOf } from '../../../_utils/logger.js';

export const onRequestOptions = () => optionsResponse();

export async function onRequest(context) {
  const { request, env, params, waitUntil } = context;
  const t0 = performance.now();
  const entry = newCallEntry('proxy', { slug: String(params.slug || '').toLowerCase(), request });

  let response;
  try {
    response = await handle(context, entry, t0);
  } catch (err) {
    entry.result.error = err?.message || '内部异常';
    entry.result.ms = Math.round((performance.now() - t0) * 10) / 10;
    throw err;
  } finally {
    writeCallLog(env, waitUntil, entry);
  }
  return response;
}

// 从响应中提取信封 code / requestId / 字节数，并记录最终状态与总耗时
async function stamped(res, entry, t0) {
  try {
    const ct = res.headers.get('content-type') || '';
    if (/json/i.test(ct)) {
      const text = await res.clone().text();
      entry.result.bytes = text.length;
      const data = JSON.parse(text);
      entry.result.code = data?.code ?? null;
      if (data?.requestId) entry.requestId = data.requestId;
    }
  } catch { /* 忽略提取失败 */ }
  entry.result.status = res.status;
  entry.result.ms = Math.round((performance.now() - t0) * 10) / 10;
  return res;
}

async function handle({ request, env, waitUntil }, entry, t0) {
  // —— 1. 认证：API Key 优先，管理员令牌可用于在线测试 ——
  let t = performance.now();
  const keyAuth = await verifyApiKey(env, request);
  let callerKey = null;
  if (keyAuth.ok) {
    callerKey = keyAuth.key;
    entry.caller = { type: 'apikey', key: maskKeyOf(callerKey), name: keyAuth.record?.name || null, note: null };
    setStage(entry, '认证', performance.now() - t, 'ok', 'API Key');
  } else {
    const adminAuth = await verifyAdmin(env, request);
    if (adminAuth.ok) {
      entry.caller = { type: 'admin', key: null, name: '管理员令牌', note: null };
      setStage(entry, '认证', performance.now() - t, 'ok', '管理员令牌');
    } else {
      entry.caller = { type: 'anonymous', key: null, name: null, note: '缺少有效凭证' };
      setStage(entry, '认证', performance.now() - t, 'fail', '缺少有效凭证');
      return stamped(keyAuth.response, entry, t0);
    }
  }

  // —— 2. 服务解析 ——
  t = performance.now();
  const slug = entry.slug;
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) {
    setStage(entry, '服务解析', performance.now() - t, 'fail', 'slug 格式不合法');
    return stamped(fail(40007, 'slug 只能包含小写字母、数字与连字符', 400), entry, t0);
  }
  const service = await getProxyService(env, slug);
  if (!service) {
    setStage(entry, '服务解析', performance.now() - t, 'fail', `代理服务「${slug}」不存在`);
    return stamped(fail(40403, `代理服务「${slug}」不存在`, 404), entry, t0);
  }
  if (service.enabled === false) {
    setStage(entry, '服务解析', performance.now() - t, 'fail', '该代理服务已被管理员停用');
    return stamped(fail(40303, `代理服务「${slug}」已被管理员停用`, 403), entry, t0);
  }
  entry.upstream.host = new URL(service.url).host;
  entry.upstream.url = service.url;
  setStage(entry, '服务解析', performance.now() - t, 'ok', service.name || slug);

  // —— 3. 配额检查 ——
  t = performance.now();
  if (callerKey) {
    const quota = Number(keyAuth.record?.dailyQuota) || 0;
    if (quota > 0) {
      const usage = await getUsage(env, todayCN());
      if ((usage.byKey[callerKey] || 0) >= quota) {
        setStage(entry, '配额检查', performance.now() - t, 'fail', `已达每日配额（${quota} 次）`);
        return stamped(fail(42901, `API Key 已达到每日配额（${quota} 次）`, 429), entry, t0);
      }
      setStage(entry, '配额检查', performance.now() - t, 'ok', `${quota} 次/天`);
    } else {
      setStage(entry, '配额检查', performance.now() - t, 'ok', '不限');
    }
  } else {
    setStage(entry, '配额检查', 0, 'skip', '管理员测试不计配额');
  }

  // —— 4. 缓存（仅 GET + 启用 KV 缓存的服务） ——
  const cacheKey = proxyCacheKey(slug, request);
  const cacheEnabled = service.cacheTtl > 0 && env.MOONAPI_KV && request.method.toUpperCase() === 'GET';
  t = performance.now();
  if (cacheEnabled) {
    const cached = await env.MOONAPI_KV.get(cacheKey).catch(() => null);
    if (cached) {
      try {
        const payload = JSON.parse(cached);
        setStage(entry, '缓存', performance.now() - t, 'ok', 'KV 命中');
        setStage(entry, '上游转发', 0, 'skip', '缓存命中，未请求上游');
        entry.result.cache = 'hit';
        if (callerKey) recordUsage(env, waitUntil, callerKey, `proxy:${slug}`);
        return stamped(ok(payload.data, { message: 'success (cache)' }), entry, t0);
      } catch { /* 缓存损坏则视为未命中 */ }
    }
    entry.result.cache = 'miss';
    setStage(entry, '缓存', performance.now() - t, 'ok', '未命中');
  } else {
    entry.result.cache = 'bypass';
    setStage(entry, '缓存', 0, 'skip', '未启用');
  }

  // —— 5. 上游转发 ——
  t = performance.now();
  let result;
  try {
    result = await forwardRequest(env, service, request);
  } catch (err) {
    if (err?.name === 'AbortError') {
      setStage(entry, '上游转发', performance.now() - t, 'fail', `响应超时（>${service.timeoutMs || 8000}ms）`);
      entry.result.error = '上游接口响应超时';
      return stamped(fail(50401, '上游接口响应超时', 504), entry, t0);
    }
    setStage(entry, '上游转发', performance.now() - t, 'fail', err?.message || '网络错误');
    entry.result.error = err?.message || '上游请求失败';
    return stamped(fail(50201, `上游接口请求失败：${err?.message || '未知错误'}`, 502), entry, t0);
  }
  entry.upstream.status = result.status;
  entry.upstream.ms = Math.round((performance.now() - t) * 10) / 10;
  setStage(entry, '上游转发', entry.upstream.ms, 'ok', `上游 HTTP ${result.status}`);

  if (callerKey) recordUsage(env, waitUntil, callerKey, `proxy:${slug}`);

  // —— 6. 响应封装 ——
  t = performance.now();
  if (result.type === 'binary') {
    entry.result.bytes = result.body.byteLength;
    if (result.status >= 400) {
      const preview = new TextDecoder().decode(result.body.slice(0, 600)).replace(/\s+/g, ' ').trim();
      setStage(entry, '响应封装', performance.now() - t, 'fail', `上游 HTTP ${result.status}，返回诊断信息（50202）`);
      entry.result.error = `上游返回 HTTP ${result.status}`;
      return stamped(json({
        code: 50202,
        message: `上游返回 HTTP ${result.status}（可能被上游防火墙拦截或接口路径错误）`,
        data: { slug, upstreamStatus: result.status, upstreamContentType: result.contentType, preview },
        requestId: crypto.randomUUID(),
      }, result.status >= 500 ? 502 : result.status), entry, t0);
    }
    setStage(entry, '响应封装', performance.now() - t, 'ok', `二进制透传 ${result.contentType}`);
    return stamped(new Response(result.body, {
      status: result.status,
      headers: {
        'content-type': result.contentType,
        'cache-control': service.cacheTtl > 0 ? `public, max-age=${service.cacheTtl}` : 'no-store',
        ...CORS_HEADERS,
      },
    }), entry, t0);
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

  setStage(entry, '响应封装', performance.now() - t, 'ok', '统一信封二创');
  return stamped(ok(data), entry, t0);
}
