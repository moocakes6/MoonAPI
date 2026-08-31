import { ok, fail, optionsResponse } from '../../_utils/http.js';
import { verifyAdmin } from '../../_utils/auth.js';
import { getProxyServices, saveProxyService, deleteProxyService } from '../../_utils/proxy.js';

export const onRequestOptions = () => optionsResponse();

export async function onRequestGet({ request, env }) {
  const auth = await verifyAdmin(env, request);
  if (!auth.ok) return auth.response;
  const services = await getProxyServices(env);
  const list = Object.entries(services).map(([slug, s]) => ({ slug, ...s }));
  list.sort((a, b) => String(a.slug).localeCompare(String(b.slug)));
  return ok({ total: list.length, services: list });
}

export async function onRequestPost({ request, env }) {
  const auth = await verifyAdmin(env, request);
  if (!auth.ok) return auth.response;

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(40000, '请求体必须是合法 JSON', 400);
  }

  if (body?.action === 'delete') {
    const slug = String(body.slug || '').toLowerCase();
    if (!slug) return fail(40009, '缺少要删除的 slug', 400);
    await deleteProxyService(env, slug);
    return ok({ deleted: slug });
  }

  const slug = String(body?.slug || '').toLowerCase().trim();
  const url = String(body?.url || '').trim();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) return fail(40007, 'slug 只能包含小写字母、数字与连字符（≤64 字符）', 400);
  if (!/^https:\/\/[^\s]+$/.test(url)) return fail(40010, '上游地址必须是以 https:// 开头的完整 URL', 400);

  const method = String(body?.method || 'GET').toUpperCase();
  if (!['GET', 'POST'].includes(method)) return fail(40011, 'method 仅支持 GET 或 POST', 400);

  let headers;
  if (body?.headers && typeof body.headers === 'object' && !Array.isArray(body.headers)) {
    headers = {};
    for (const [k, v] of Object.entries(body.headers).slice(0, 10)) {
      const key = String(k).trim().toLowerCase();
      if (key) headers[key] = String(v);
    }
  }

  const service = await saveProxyService(env, slug, {
    name: String(body?.name || slug).slice(0, 80),
    description: String(body?.description || '').slice(0, 300),
    url,
    method,
    enabled: body?.enabled !== false,
    cacheTtl: Math.max(0, Math.min(86400, Number(body?.cacheTtl) || 0)),
    timeoutMs: Math.max(1000, Math.min(20000, Number(body?.timeoutMs) || 8000)),
    ...(headers ? { headers } : {}),
  });
  return ok({ slug, ...service }, { message: '代理服务已保存' });
}
