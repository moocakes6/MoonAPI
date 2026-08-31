export async function getCardIndex(env) {
  const raw = await env.MOONAPI_KV.get('cards:index');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveCardIndex(env, index) {
  await env.MOONAPI_KV.put('cards:index', JSON.stringify(index));
}

export async function getCard(env, id) {
  const obj = await env.MOONAPI_R2.get(`cards/${id}.json`);
  if (!obj) return null;
  try {
    return await obj.json();
  } catch {
    return null;
  }
}

export async function putCard(env, card) {
  await env.MOONAPI_R2.put(`cards/${card.id}.json`, JSON.stringify(card), {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: { title: String(card.title || '').slice(0, 200) },
  });
}

export async function deleteCard(env, id) {
  await env.MOONAPI_R2.delete(`cards/${id}.json`);
  const pins = await env.MOONAPI_KV.list({ prefix: 'daily:' });
  for (const pin of pins.keys) {
    if ((await env.MOONAPI_KV.get(pin.name)) === id) await env.MOONAPI_KV.delete(pin.name);
  }
}

const FALLBACK_CARDS = [
  { title: '月亮的引力只有地球的六分之一', category: '科学', content: '如果你站在月球上，体重会轻到可以轻易跳过两层楼的高度。阿波罗宇航员在月面的跳跃画面，正是低重力环境的真实写照。', source: 'NASA 科普' },
  { title: '「床前明月光」里的「床」可能不是卧具', category: '文史', content: '关于李白《静夜思》中「床」的解释，学界有井栏、胡床（坐具）等说法。若理解为井栏，月光洒在井边、举头望月的画面会更符合唐代的生活场景。', source: '古典文学研究' },
  { title: '蜂蜜几乎永远不会变质', category: '生活', content: '考古学家在埃及金字塔中发现过三千多年前的蜂蜜，至今仍可食用。低水分、高酸度和天然过氧化氢让细菌难以生存。', source: '食品科学常识' },
  { title: '世界上第一个 API 比互联网更早', category: '技术', content: 'API 的思想源于 20 世纪 40 年代的软件模块化调用。1990 年代 Web 服务兴起后，「API」才逐渐成为互联网服务的标准接口形态——你正在使用的 MoonAPI 也延续了这一传统。', source: '计算机历史' },
  { title: '北极星并不是天空中最亮的星', category: '科学', content: '北极星（勾陈一）的亮度只排在夜空第 45 位左右，它出名是因为几乎正对地轴、终年不动，自古是导航与定位的基准。', source: '天文常识' },
];

export function getFallbackCard(date) {
  const idx = Math.abs(hashString(date)) % FALLBACK_CARDS.length;
  const base = FALLBACK_CARDS[idx];
  return { id: `builtin-${idx}`, builtin: true, createdAt: null, updatedAt: null, ...base };
}

export function hashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return h;
}

export async function pickDailyCard(env, date) {
  const pinnedId = await env.MOONAPI_KV.get(`daily:${date}`);
  if (pinnedId) {
    const pinned = await getCard(env, pinnedId);
    if (pinned) return { card: pinned, source: 'pinned' };
  }
  const index = await getCardIndex(env);
  if (index.length > 0) {
    const sorted = [...index].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const chosen = sorted[Math.abs(hashString(date)) % sorted.length];
    const card = await getCard(env, chosen.id);
    if (card) return { card, source: 'auto' };
  }
  return { card: getFallbackCard(date), source: 'builtin' };
}

export function normalizeCard(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const title = String(input.title || '').trim();
  const content = String(input.content || '').trim();
  if (!title || !content) return null;
  return {
    title: title.slice(0, 120),
    category: String(input.category || '未分类').trim().slice(0, 40),
    content: content.slice(0, 5000),
    source: String(input.source || '').trim().slice(0, 200),
    tags: Array.isArray(input.tags) ? input.tags.map((t) => String(t).slice(0, 40)).slice(0, 10) : [],
  };
}
