import { ok, fail, optionsResponse, todayCN } from '../../_utils/http.js';
import { verifyApiKey } from '../../_utils/auth.js';
import { pickDailyCard } from '../../_utils/cards.js';

export const onRequestOptions = () => optionsResponse();

export async function onRequestGet({ request, env }) {
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

  const { card, source } = await pickDailyCard(env, date);
  return ok({ date, source, card });
}
