import { ok, fail, optionsResponse } from '../../_utils/http.js';
import { verifyAdmin } from '../../_utils/auth.js';
import { getCardIndex, readMeta, writeMeta } from '../../_utils/cards.js';
import { importCards, seedBatch } from '../../_utils/seed.js';

const SEED_FLAG_KEY = 'meta/seed-applied.json';

export const onRequestOptions = () => optionsResponse();

export async function onRequestGet({ request, env }) {
  const auth = await verifyAdmin(env, request);
  if (!auth.ok) return auth.response;

  let index = await getCardIndex(env);
  let seeded = await readMeta(env, SEED_FLAG_KEY, null);

  // 首次使用：未导入过内置资料库时自动分批导入（342 条，每批 ≤30 条以规避单请求 50 子请求上限；
  // 前提改为只看 applied 标记——否则「先建卡、后逛库」的时序会让惰性导入永久跳过，
  // 卡片库只剩用户自建卡导致每日轮换失效）。后台卡片页会自动连续推进直至完成。
  let seedJustFinished = false;
  if (!seeded?.applied) {
    try {
      const result = await seedBatch(env, request);
      if (result.done) {
        await writeMeta(env, SEED_FLAG_KEY, { applied: true, count: result.progress.totalCreated, at: new Date().toISOString() });
        seedJustFinished = true;
      }
      index = await getCardIndex(env);
    } catch (e) {
      console.error('seed batch failed:', e?.message || e);
    }
  }

  index.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const seedProgress = await readMeta(env, 'meta/seed-progress.json', null);
  const seed = (seeded?.applied || seedJustFinished)
    ? { applied: true }
    : { applied: false, offset: seedProgress?.offset || 0, total: seedProgress?.total || 342 };
  return ok({ total: index.length, cards: index, seed });
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
