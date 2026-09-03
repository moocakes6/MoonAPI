// 管理接口：调用日志查询与清理
// GET  /api/admin/logs?days=7&limit=100&route=proxy&slug=hitokoto&status=error&requestId=xxxx
// GET  /api/admin/logs?key=logs/2026-09-03/084812-464-a1b2.json   （单条明细）
// POST /api/admin/logs  { "action": "clear", "keepDays": 30 }      （清理，keepDays=0 清空）
import { ok, fail, optionsResponse } from '../../_utils/http.js';
import { verifyAdmin } from '../../_utils/auth.js';
import { listCallLogs, getCallLog, clearCallLogs, RETENTION_DAYS } from '../../_utils/logger.js';

export const onRequestOptions = () => optionsResponse();

export async function onRequestGet({ request, env }) {
  const auth = await verifyAdmin(env, request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);

  const key = url.searchParams.get('key');
  if (key) {
    const entry = await getCallLog(env, key);
    if (!entry) return fail(40405, '日志条目不存在或已被清理', 404);
    return ok({ entry });
  }

  const days = Number(url.searchParams.get('days')) || 7;
  const limit = Number(url.searchParams.get('limit')) || 100;
  const route = url.searchParams.get('route') || null;
  const slug = url.searchParams.get('slug') || null;
  const status = url.searchParams.get('status') || null;
  const requestId = url.searchParams.get('requestId') || null;

  const entries = await listCallLogs(env, { days, limit, route, slug, status, requestId });

  const okCount = entries.filter((e) => e.result?.code === 0).length;
  const latencies = entries.map((e) => e.result?.ms).filter((v) => typeof v === 'number' && v >= 0);
  const byRoute = {};
  const bySlug = {};
  for (const e of entries) {
    byRoute[e.route] = (byRoute[e.route] || 0) + 1;
    if (e.route === 'proxy') bySlug[e.slug || '?'] = (bySlug[e.slug || '?'] || 0) + 1;
  }

  return ok({
    days,
    limit,
    total: entries.length,
    entries,
    summary: {
      total: entries.length,
      ok: okCount,
      error: entries.length - okCount,
      avgMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
      cacheHits: entries.filter((e) => e.result?.cache === 'hit').length,
      byRoute,
      bySlug,
    },
    retentionDays: RETENTION_DAYS,
  });
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

  if (body?.action === 'clear') {
    const keepDays = Math.max(0, Math.min(365, Number(body.keepDays) || 0));
    const result = await clearCallLogs(env, { keepDays });
    return ok(result, { message: result.deleted ? `已清理 ${result.deleted} 条调用日志` : '没有可清理的日志' });
  }

  return fail(40012, '未知的 action，仅支持 clear', 400);
}
