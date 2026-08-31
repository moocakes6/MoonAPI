import { ok, fail, optionsResponse } from '../../_utils/http.js';
import { verifyAdmin } from '../../_utils/auth.js';
import { getCardIndex, saveCardIndex, putCard, getCard, normalizeCard } from '../../_utils/cards.js';

export const onRequestOptions = () => optionsResponse();

export async function onRequestGet({ request, env }) {
  const auth = await verifyAdmin(env, request);
  if (!auth.ok) return auth.response;
  const index = await getCardIndex(env);
  index.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return ok({ total: index.length, cards: index });
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
  const items = Array.isArray(body?.cards) ? body.cards : [body];
  if (items.length === 0 || items.length > 500) return fail(40003, '单次批量导入需在 1-500 条之间', 400);

  const now = new Date().toISOString();
  const index = await getCardIndex(env);
  const created = [];
  const skipped = [];

  for (const item of items) {
    const clean = normalizeCard(item);
    if (!clean) {
      skipped.push({ title: String(item?.title || '(无标题)'), reason: '缺少 title 或 content' });
      continue;
    }
    const id = crypto.randomUUID();
    const card = { id, ...clean, createdAt: now, updatedAt: now };
    await putCard(env, card);
    index.push({ id, title: clean.title, category: clean.category, updatedAt: now });
    created.push({ id, title: clean.title });
  }

  await saveCardIndex(env, index);
  return ok({ created: created.length, skipped: skipped.length, cards: created, skippedDetail: skipped });
}
