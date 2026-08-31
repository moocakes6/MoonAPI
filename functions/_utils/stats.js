import { readMeta, writeMeta } from './cards.js';
import { todayCN } from './http.js';

const queues = new WeakMap();

export async function getUsage(env, date) {
  const stats = await readMeta(env, `stats/${date}.json`, null);
  return stats && typeof stats === 'object' ? stats : { date, total: 0, byKey: {}, byEndpoint: {} };
}

export function recordUsage(env, waitUntil, key, endpoint) {
  const date = todayCN();
  const job = async () => {
    const stats = await getUsage(env, date);
    stats.total = (stats.total || 0) + 1;
    if (key) stats.byKey[key] = (stats.byKey[key] || 0) + 1;
    stats.byEndpoint[endpoint] = (stats.byEndpoint[endpoint] || 0) + 1;
    await writeMeta(env, `stats/${date}.json`, stats);
  };
  // 同一请求上下文内的多次记录串行执行，避免读改写竞态丢计数
  const prev = queues.get(waitUntil) || Promise.resolve();
  const next = prev.then(job, job);
  queues.set(waitUntil, next);
  waitUntil(next.catch(() => {}));
}

export async function getRecentUsage(env, days) {
  const result = [];
  for (let i = 0; i < days; i++) {
    const date = todayCN(-i);
    result.push(await getUsage(env, date));
  }
  return result;
}
