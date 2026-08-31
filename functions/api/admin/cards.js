import { ok, fail, optionsResponse } from '../../_utils/http.js';
import { verifyAdmin } from '../../_utils/auth.js';
import { getCardIndex, readMeta, writeMeta } from '../../_utils/cards.js';
import { importCards, seedLibrary } from '../../_utils/seed.js';

const SEED_FLAG_KEY = 'meta/seed-applied.json';

export const onRequestOptions = () => optionsResponse();

export async function onRequestGet({ request, env }) {
  const auth = await verifyAdmin(env, request);
  if (!auth.ok) return auth.response;

  let index = await getCardIndex(env);
  const seeded = await readMeta(env, SEED_FLAG_KEY, null);

  // 首次使用：卡片库为空且未导入过内置资料库时，自动导入 342 条内置卡片
  if (index.length === 0 && !seeded?.applied) {
    try {
      const result = await seedLibrary(env, request);
      await writeMeta(env, SEED_FLAG_KEY, { applied: true, count: result.created, at: new Date().toISOString() });
      index = await getCardIndex(env);
    } catch {}
  }

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

  const result = await importCards(env, items);
  return ok(result);
}
