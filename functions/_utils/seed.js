import { getCardIndex, saveCardIndex, putCard, normalizeCard } from './cards.js';

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

export async function seedLibrary(env, request, sourcePath = '/data/seed-library.json') {
  const url = new URL(sourcePath, request.url);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`数据包加载失败（HTTP ${res.status}）`);
  const payload = await res.json();
  const items = Array.isArray(payload) ? payload : payload?.cards;
  if (!Array.isArray(items) || items.length === 0) throw new Error('数据包格式不正确');
  return importCards(env, items.slice(0, 1000));
}
