import { ok, fail, optionsResponse } from '../../_utils/http.js';
import { verifyAdmin } from '../../_utils/auth.js';
import { getDailyPins, saveDailyPins } from '../../_utils/cards.js';

export const onRequestOptions = () => optionsResponse();

export async function onRequestGet({ request, env }) {
  const auth = await verifyAdmin(env, request);
  if (!auth.ok) return auth.response;

  const map = await getDailyPins(env);
  const pins = Object.entries(map)
    .map(([date, cardId]) => ({ date, cardId }))
    .sort((a, b) => b.date.localeCompare(a.date));
  return ok({ total: pins.length, pins });
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
  const { date, cardId } = body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return fail(40001, 'date 格式应为 YYYY-MM-DD', 400);

  const pins = await getDailyPins(env);
  if (!cardId) {
    if (!(date in pins)) return ok({ date, cardId: null }, { message: '该日无排期，无需清除' });
    delete pins[date];
    await saveDailyPins(env, pins);
    return ok({ date, cardId: null }, { message: '已清除该日排期' });
  }
  const exists = await env.MOONAPI_R2.head(`cards/${cardId}.json`);
  if (!exists) return fail(40401, '指定的卡片不存在', 404);
  pins[date] = String(cardId);
  await saveDailyPins(env, pins);
  return ok({ date, cardId }, { message: '排期已保存' });
}
