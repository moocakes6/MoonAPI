// 调用日志引擎 —— 每次对外调用写一条 R2 明细对象（权威记录），并在当日索引中追加摘要（列表读路径）。
// 设计要点：
// 1) 写路径全部发生在 waitUntil 中，绝不阻塞主响应；
// 2) 明细对象键 logs/{CN日期}/{HHmmss}-{ms}-{rand}.json，同日内字典序即时间序；
// 3) 索引 meta/call-log-index/{CN日期}.json 仅存列表所需摘要，列表接口每天只读 1 次 R2，节省子请求配额；
// 4) 索引为读-改-写追加，极端并发下可能丢个别摘要指针（明细对象仍在，可通过清理/重建恢复），个人流量下可忽略；
// 5) 写入时低概率触发过期清理（默认保留 30 天），管理员也可在后台手动清理。

const INDEX_PREFIX = 'meta/call-log-index';
export const RETENTION_DAYS = 30;
export const MAX_INDEX_ENTRIES = 1200;

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function cnDateOffset(offsetDays = 0, ts = Date.now()) {
  return new Date(ts + 8 * 3600 * 1000 + offsetDays * 86400000).toISOString().slice(0, 10);
}

function cnTimeParts(ts = Date.now()) {
  const d = new Date(ts + 8 * 3600 * 1000);
  return `${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}`;
}

export function maskKeyOf(key) {
  const k = String(key || '');
  if (!k) return null;
  if (k.length <= 12) return k;
  return `${k.slice(0, 8)}••••••${k.slice(-4)}`;
}

const SENSITIVE_PARAM = /^(key|token|secret|password|apikey|api_key|authorization|access_token)$/i;

export function newCallEntry(route, { slug = null, request }) {
  const url = new URL(request.url);
  const query = {};
  let i = 0;
  for (const [k, v] of url.searchParams) {
    if (i++ >= 12) break;
    const name = String(k).slice(0, 60);
    query[name] = SENSITIVE_PARAM.test(name) ? '******' : String(v).slice(0, 200);
  }
  return {
    id: null,
    key: null,
    ts: new Date().toISOString(),
    route,
    slug: slug || null,
    endpoint: route === 'proxy' ? `/api/v1/proxy/${slug || ''}` : '/api/v1/daily-card',
    method: (request.method || 'GET').toUpperCase(),
    query,
    caller: { type: 'anonymous', key: null, name: null, note: null },
    upstream: { host: null, url: null, status: null, ms: null },
    stages: [],
    result: { status: null, code: null, cache: 'bypass', bytes: null, ms: null, error: null },
    ua: (request.headers.get('user-agent') || '').slice(0, 180) || null,
    country: request.cf?.country || null,
    ray: request.headers.get('cf-ray') || null,
    requestId: null,
  };
}

export function setStage(entry, name, ms, s = 'ok', note = null) {
  entry.stages.push({ name, ms: ms == null ? null : Math.round(ms * 10) / 10, s, note: note || null });
}

function indexView(entry) {
  return {
    id: entry.id,
    key: entry.key,
    ts: entry.ts,
    route: entry.route,
    slug: entry.slug,
    endpoint: entry.endpoint,
    method: entry.method,
    caller: { type: entry.caller.type, key: entry.caller.key, name: entry.caller.name, note: entry.caller.note || null },
    upstream: { host: entry.upstream.host, status: entry.upstream.status, ms: entry.upstream.ms },
    stages: entry.stages,
    result: entry.result,
    requestId: entry.requestId,
  };
}

async function appendDayIndex(env, date, entry) {
  const idxKey = `${INDEX_PREFIX}/${date}.json`;
  let list = [];
  const obj = await env.MOONAPI_R2.get(idxKey);
  if (obj) list = await obj.json().catch(() => []);
  if (!Array.isArray(list)) list = [];
  list.push(indexView(entry));
  if (list.length > MAX_INDEX_ENTRIES) list = list.slice(-MAX_INDEX_ENTRIES);
  await env.MOONAPI_R2.put(idxKey, JSON.stringify(list), { httpMetadata: { contentType: 'application/json' } });
}

export async function writeCallLog(env, waitUntil, entry) {
  if (!env?.MOONAPI_R2 || typeof waitUntil !== 'function') return;
  const job = async () => {
    try {
      const now = Date.now();
      const date = cnDateOffset(0, now);
      const rand = [...crypto.getRandomValues(new Uint8Array(2))]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const entryKey = `logs/${date}/${cnTimeParts(now)}-${String(now % 1000).padStart(3, '0')}-${rand}.json`;
      entry.key = entryKey;
      entry.id = entryKey.replace(/^logs\//, '').replace(/\.json$/, '');
      if (!entry.requestId) entry.requestId = crypto.randomUUID().slice(0, 8);
      await env.MOONAPI_R2.put(entryKey, JSON.stringify(entry), { httpMetadata: { contentType: 'application/json' } });
      await appendDayIndex(env, date, entry);
      if (Math.random() < 0.02) await clearCallLogs(env, { keepDays: RETENTION_DAYS });
    } catch {
      /* 日志写入失败不影响主流程 */
    }
  };
  waitUntil(job());
}

const LOG_KEY_RE = /^logs\/\d{4}-\d{2}-\d{2}\/\d{6}-\d{3}-[0-9a-f]{4}\.json$/;

export async function getCallLog(env, key) {
  if (!LOG_KEY_RE.test(String(key || ''))) return null;
  const obj = await env.MOONAPI_R2.get(String(key));
  if (!obj) return null;
  return obj.json().catch(() => null);
}

export async function listCallLogs(env, { days = 7, limit = 100, route = null, slug = null, status = null, requestId = null } = {}) {
  const out = [];
  const dayCount = Math.max(1, Math.min(30, Number(days) || 7));
  const max = Math.max(1, Math.min(300, Number(limit) || 100));
  for (let i = 0; i < dayCount && out.length < max; i++) {
    const date = cnDateOffset(-i);
    const obj = await env.MOONAPI_R2.get(`${INDEX_PREFIX}/${date}.json`);
    if (!obj) continue;
    const list = await obj.json().catch(() => []);
    for (let j = list.length - 1; j >= 0 && out.length < max; j--) {
      const e = list[j];
      if (!e || typeof e !== 'object') continue;
      if (route && e.route !== route) continue;
      if (slug && e.slug !== slug) continue;
      if (status === 'success' && e.result?.code !== 0) continue;
      if (status === 'error' && e.result?.code === 0) continue;
      if (requestId && e.requestId !== requestId) continue;
      out.push(e);
    }
  }
  return out;
}

async function deleteDateData(env, date) {
  const keys = [];
  let cursor;
  do {
    const page = await env.MOONAPI_R2.list({ prefix: `logs/${date}/`, cursor, limit: 500 });
    for (const o of page.objects) keys.push(o.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && keys.length < 1000);
  if (keys.length) await env.MOONAPI_R2.delete(keys.slice(0, 1000));
  await env.MOONAPI_R2.delete(`${INDEX_PREFIX}/${date}.json`);
  return keys.length;
}

// 清理调用日志：keepDays=0 表示清空全部；否则保留最近 keepDays 天（今天算第 1 天）。
// 单次调用最多处理 10 天的数据，避免超出 Workers 子请求预算；未清完返回 hasMore=true，可重复调用。
export async function clearCallLogs(env, { keepDays = 30 } = {}) {
  if (!env?.MOONAPI_R2) return { deleted: 0, hasMore: false };
  const keep = Math.max(0, Math.min(365, Number(keepDays) || 0));
  const cutoff = keep <= 0 ? '9999-99-99' : cnDateOffset(-(keep - 1));
  let deleted = 0;
  let processed = 0;
  let cursor;
  let truncated = false;
  do {
    const page = await env.MOONAPI_R2.list({ prefix: 'logs/', delimiter: '/', cursor });
    truncated = !!page.truncated;
    cursor = page.truncated ? page.cursor : undefined;
    const days = (page.delimitedPrefixes || [])
      .map((p) => ({ prefix: p, date: String(p).slice(5, 15) }))
      .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.date < cutoff)
      .sort((a, b) => a.date.localeCompare(b.date));
    for (const d of days) {
      if (processed >= 10) break;
      deleted += await deleteDateData(env, d.date);
      processed += 1;
    }
  } while (truncated && processed < 10);
  return { deleted, hasMore: processed >= 10 };
}
