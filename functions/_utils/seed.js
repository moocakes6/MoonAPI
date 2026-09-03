import { getCardIndex, saveCardIndex, putCard, normalizeCard, readMeta, writeMeta } from './cards.js';

export async function importCards(env, items) {
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
  return { created: created.length, skipped: skipped.length, cards: created, skippedDetail: skipped.slice(0, 50) };
}

// 内置资料库分批导入：342 条逐条写 R2 会超出 Workers 单请求 50 子请求上限，
// 改为每批 30 条（约 39 个子请求），由后台卡片页加载时自动连续推进直至完成。
const SEED_BATCH_SIZE = 30;
const SEED_PROGRESS_KEY = 'meta/seed-progress.json';

export async function seedBatch(env, request, sourcePath = '/data/seed-library.json') {
  const progress = (await readMeta(env, SEED_PROGRESS_KEY, null)) || { offset: 0, totalCreated: 0, totalSkipped: 0, total: 0 };
  const url = new URL(sourcePath, request.url);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`数据包加载失败（HTTP ${res.status}）`);
  const payload = await res.json();
  const items = Array.isArray(payload) ? payload : payload?.cards;
  if (!Array.isArray(items) || items.length === 0) throw new Error('数据包格式不正确');

  const batch = items.slice(progress.offset, progress.offset + SEED_BATCH_SIZE);
  const result = await importCards(env, batch);
  const next = {
    offset: progress.offset + batch.length,
    total: items.length,
    totalCreated: (progress.totalCreated || 0) + result.created,
    totalSkipped: (progress.totalSkipped || 0) + result.skipped,
  };
  await writeMeta(env, SEED_PROGRESS_KEY, next);
  return { done: next.offset >= next.total, progress: next, created: result.created, skipped: result.skipped };
}
