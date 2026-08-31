import { ok, fail, optionsResponse } from '../../../_utils/http.js';
import { verifyAdmin } from '../../../_utils/auth.js';
import { getCardIndex, saveCardIndex, getCard, putCard, deleteCard, normalizeCard } from '../../../_utils/cards.js';

export const onRequestOptions = () => optionsResponse();

export async function onRequest({ request, env, params }) {
  const auth = await verifyAdmin(env, request);
  if (!auth.ok) return auth.response;

  const method = request.method.toUpperCase();
  if (method === 'GET') return readCard(env, params.id);
  if (method === 'PUT') return updateCard(env, request, params.id);
  if (method === 'DELETE') return removeCard(env, params.id);
  return fail(40500, '不支持的请求方法', 405);
}

async function readCard(env, id) {
  const card = await getCard(env, id);
  if (!card) return fail(40401, '卡片不存在', 404);
  return ok(card);
}

async function updateCard(env, request, id) {
  const existing = await getCard(env, id);
  if (!existing) return fail(40401, '卡片不存在', 404);
  let body;
  try {
    body = await request.json();
  } catch {
    return fail(40000, '请求体必须是合法 JSON', 400);
  }
  const merged = normalizeCard({ ...existing, ...body });
  if (!merged) return fail(40004, '更新后缺少有效的 title 或 content', 400);
  const now = new Date().toISOString();
  const card = { ...existing, ...merged, updatedAt: now };
  await putCard(env, card);

  const index = await getCardIndex(env);
  const entry = index.find((c) => c.id === id);
  if (entry) {
    entry.title = merged.title;
    entry.category = merged.category;
    entry.updatedAt = now;
  } else {
    index.push({ id, title: merged.title, category: merged.category, updatedAt: now });
  }
  await saveCardIndex(env, index);
  return ok(card);
}

async function removeCard(env, id) {
  const index = await getCardIndex(env);
  const exists = index.some((c) => c.id === id) || (await getCard(env, id));
  if (!exists) return fail(40401, '卡片不存在', 404);
  await deleteCard(env, id);
  await saveCardIndex(env, index.filter((c) => c.id !== id));
  return ok({ deleted: 1 });
}
