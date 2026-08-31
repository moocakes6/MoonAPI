import { ok, fail, optionsResponse } from '../../_utils/http.js';
import { verifyAdmin } from '../../_utils/auth.js';

export const onRequestOptions = () => optionsResponse();

export async function onRequestGet({ request, env }) {
  const auth = await verifyAdmin(env, request);
  if (!auth.ok) return auth.response;

  const pins = [];
  let cursor;
  do {
    const page = await env.MOONAPI_KV.list({ prefix: 'daily:', cursor });
    for (const key of page.keys) {
      pins.push({ date: key.name.slice(6), cardId: await env.MOONAPI_KV.get(key.name) });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  pins.sort((a, b) => b.date.localeCompare(a.date));
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

  if (!cardId) {
    await env.MOONAPI_KV.delete(`daily:${date}`);
    return ok({ date, cardId: null }, { message: '已清除该日排期' });
  }
  const exists = await env.MOONAPI_R2.head(`cards/${cardId}.json`);
  if (!exists) return fail(40401, '指定的卡片不存在', 404);
  await env.MOONAPI_KV.put(`daily:${date}`, String(cardId));
  return ok({ date, cardId }, { message: '排期已保存' });
}
