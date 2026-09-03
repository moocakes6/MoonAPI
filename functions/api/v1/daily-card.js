// GET /api/v1/daily-card —— 每日知识卡片（API Key 认证；管理员令牌可用于在线测试）
// 全链路阶段计时并写入调用日志，阶段：认证 → 日期解析 → 配额检查 → 卡片选取 → 响应封装
import { ok, fail, optionsResponse, todayCN } from '../../_utils/http.js';
import { verifyApiKey, verifyAdmin } from '../../_utils/auth.js';
import { pickDailyCard } from '../../_utils/cards.js';
import { getUsage, recordUsage } from '../../_utils/stats.js';
import { newCallEntry, setStage, writeCallLog, maskKeyOf } from '../../_utils/logger.js';

export const onRequestOptions = () => optionsResponse();

export async function onRequestGet({ request, env, waitUntil }) {
  const t0 = performance.now();
  const entry = newCallEntry('daily-card', { request });

  let response;
  try {
    response = await handle({ request, env, waitUntil }, entry, t0);
  } catch (err) {
    entry.result.error = err?.message || '内部异常';
    entry.result.ms = Math.round((performance.now() - t0) * 10) / 10;
    throw err;
  } finally {
    writeCallLog(env, waitUntil, entry);
  }
  return response;
}

// 从 JSON 响应中提取信封 code / requestId / 字节数，并记录最终状态与总耗时
async function stamped(res, entry, t0) {
  try {
    const text = await res.clone().text();
    entry.result.bytes = text.length;
    const data = JSON.parse(text);
    entry.result.code = data?.code ?? null;
    if (data?.requestId) entry.requestId = data.requestId;
  } catch { /* 忽略提取失败 */ }
  entry.result.status = res.status;
  entry.result.ms = Math.round((performance.now() - t0) * 10) / 10;
  return res;
}

const SOURCE_NOTE = { pinned: '排期指定', auto: '按日期轮换', builtin: '内置兜底卡片' };

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

  // —— 2. 日期解析 ——
  t = performance.now();
  const url = new URL(request.url);
  const dateParam = url.searchParams.get('date');
  let date;
  if (dateParam) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      setStage(entry, '日期解析', performance.now() - t, 'fail', 'date 参数格式错误');
      return stamped(fail(40001, 'date 参数格式应为 YYYY-MM-DD', 400), entry, t0);
    }
    date = dateParam;
  } else {
    date = todayCN();
  }
  entry.query = { date };
  setStage(entry, '日期解析', performance.now() - t, 'ok', date === todayCN() ? '今天' : date);

  // —— 3. 配额检查 ——
  t = performance.now();
  const quota = Number(keyAuth.record?.dailyQuota) || 0;
  if (callerKey && quota > 0) {
    const usage = await getUsage(env, todayCN());
    if ((usage.byKey[callerKey] || 0) >= quota) {
      setStage(entry, '配额检查', performance.now() - t, 'fail', `已达每日配额（${quota} 次）`);
      return stamped(fail(42901, `API Key 已达到每日配额（${quota} 次）`, 429), entry, t0);
    }
    setStage(entry, '配额检查', performance.now() - t, 'ok', `${quota} 次/天`);
  } else if (callerKey) {
    setStage(entry, '配额检查', performance.now() - t, 'ok', '不限');
  } else {
    setStage(entry, '配额检查', 0, 'skip', '管理员测试不计配额');
  }

  // —— 4. 卡片选取 ——
  t = performance.now();
  const { card, source } = await pickDailyCard(env, date);
  setStage(entry, '卡片选取', performance.now() - t, 'ok', SOURCE_NOTE[source] || source);

  recordUsage(env, waitUntil, callerKey, 'daily-card');

  // —— 5. 响应封装 ——
  t = performance.now();
  const res = ok({ date, source, card });
  setStage(entry, '响应封装', performance.now() - t, 'ok', `来源 ${source}`);
  return stamped(res, entry, t0);
}
