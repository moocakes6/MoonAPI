import { ok, fail, optionsResponse, todayCN } from '../../_utils/http.js';
import { verifyApiKey } from '../../_utils/auth.js';
import { pickDailyCard } from '../../_utils/cards.js';
import { getUsage, recordUsage } from '../../_utils/stats.js';

export const onRequestOptions = () => optionsResponse();

export async function onRequestGet({ request, env, waitUntil }) {
  const auth = await verifyApiKey(env, request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const dateParam = url.searchParams.get('date');
  let date;
  if (dateParam) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) return fail(40001, 'date 参数格式应为 YYYY-MM-DD', 400);
    date = dateParam;
  } else {
    date = todayCN();
  }

  const quota = Number(auth.record?.dailyQuota) || 0;
  if (quota > 0) {
    const usage = await getUsage(env, todayCN());
    if ((usage.byKey[auth.key] || 0) >= quota) {
      return fail(42901, `API Key 已达到每日配额（${quota} 次）`, 429);
    }
  }

  const { card, source } = await pickDailyCard(env, date);
  recordUsage(env, waitUntil, auth.key, 'daily-card');
  return ok({ date, source, card });
}
