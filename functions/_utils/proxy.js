import { readMeta, writeMeta } from './cards.js';

const REGISTRY_KEY = 'meta/proxy-services.json';

export const DEFAULT_SERVICES = {
  'yujin-root': {
    name: '雨瑾云 · 站点首页',
    description: 'api.yujin.cn 根路径，用于探测站点可用性。若其恢复可用，可在后台直接新增该站具体接口，无需改代码',
    url: 'https://api.yujin.cn/',
    method: 'GET',
    enabled: true,
    cacheTtl: 300,
    timeoutMs: 10000,
    builtin: true,
  },
  hitokoto: {
    name: '一言 · 随机句子（文本）',
    description: 'hitokoto.cn 公开接口，返回随机一言文本，JSON 信封二创示例',
    url: 'https://v1.hitokoto.cn/',
    method: 'GET',
    enabled: true,
    cacheTtl: 60,
    timeoutMs: 8000,
    builtin: true,
  },
  'bing-wallpaper': {
    name: 'Bing 每日壁纸（图片）',
    description: 'bing.biturl.top 随机壁纸，二进制透传示例，可直接用于 <img src>',
    url: 'https://bing.biturl.top/',
    method: 'GET',
    enabled: true,
    cacheTtl: 3600,
    timeoutMs: 10000,
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

const BROWSER_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/json;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

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
  const headers = { ...BROWSER_HEADERS };
  if (service.headers && typeof service.headers === 'object') {
    for (const [k, v] of Object.entries(service.headers)) headers[String(k).toLowerCase()] = String(v);
  }

  const init = { method, headers, redirect: 'follow' };
  if (method !== 'GET' && method !== 'HEAD' && request.body) {
    init.body = request.body;
    const contentType = request.headers.get('content-type');
    if (contentType) headers['content-type'] = contentType;
  }

  const res = await fetchWithTimeout(target.toString(), init, service.timeoutMs || 8000);
  const contentType = res.headers.get('content-type') || 'application/octet-stream';

  if (/json/i.test(contentType)) {
    const upstream = await res.json().catch(() => null);
    return { type: 'json', status: res.status, upstream };
  }

  const body = await res.arrayBuffer();
  return { type: 'binary', status: res.status, body, contentType };
}

export function proxyCacheKey(slug, request) {
  const url = new URL(request.url);
  return `proxy:${slug}:${url.search || 'noquery'}`;
}
