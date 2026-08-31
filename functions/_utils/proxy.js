import { readMeta, writeMeta } from './cards.js';

const REGISTRY_KEY = 'meta/proxy-services.json';

export const DEFAULT_SERVICES = {
  'yujin-root': {
    name: '雨瑾云 · 站点首页',
    description: 'api.yujin.cn 根路径，用于探测站点可用性与接口目录',
    url: 'https://api.yujin.cn/',
    method: 'GET',
    enabled: true,
    cacheTtl: 300,
    timeoutMs: 8000,
    builtin: true,
  },
};

export async function getProxyServices(env) {
  const stored = await readMeta(env, REGISTRY_KEY, null);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return { ...DEFAULT_SERVICES };
  return { ...DEFAULT_SERVICES, ...stored };
}

export async function getProxyService(env, slug) {
  const services = await getProxyServices(env);
  return services[slug] || null;
}

export async function saveProxyService(env, slug, service) {
  const stored = await readMeta(env, REGISTRY_KEY, {});
  const registry = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  registry[slug] = { ...DEFAULT_SERVICES[slug], ...service };
  await writeMeta(env, REGISTRY_KEY, registry);
  return registry[slug];
}

export async function deleteProxyService(env, slug) {
  const stored = await readMeta(env, REGISTRY_KEY, {});
  const registry = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  delete registry[slug];
  await writeMeta(env, REGISTRY_KEY, registry);
}

function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export async function forwardRequest(env, service, request) {
  const caller = new URL(request.url);
  const target = new URL(service.url);
  caller.searchParams.forEach((value, key) => target.searchParams.set(key, value));

  const method = (service.method || 'GET').toUpperCase();
  const init = {
    method,
    headers: {
      'user-agent': 'MoonAPI/1.0 (+https://api.lunor.top)',
      accept: 'application/json, text/plain, */*',
    },
  };
  if (method !== 'GET' && method !== 'HEAD' && request.body) {
    init.body = request.body;
    const contentType = request.headers.get('content-type');
    if (contentType) init.headers['content-type'] = contentType;
  }

  const res = await fetchWithTimeout(target.toString(), init, service.timeoutMs || 8000);
  const contentType = res.headers.get('content-type') || 'application/octet-stream';

  if (/json/i.test(contentType)) {
    const upstream = await res.json().catch(() => null);
    return { type: 'json', status: res.status, upstream };
  }
  return { type: 'binary', status: res.status, body: res.body, contentType };
}

export function proxyCacheKey(slug, request) {
  const url = new URL(request.url);
  return `proxy:${slug}:${url.search || 'noquery'}`;
}
