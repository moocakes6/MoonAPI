import { ok, optionsResponse } from '../../_utils/http.js';
import { verifyAdmin } from '../../_utils/auth.js';
import { getRecentUsage } from '../../_utils/stats.js';
import { getCardIndex } from '../../_utils/cards.js';
import { getApiKeys } from '../../_utils/auth.js';
import { getProxyServices } from '../../_utils/proxy.js';

export const onRequestOptions = () => optionsResponse();

export async function onRequestGet({ request, env }) {
  const auth = await verifyAdmin(env, request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const days = Math.max(1, Math.min(30, Number(url.searchParams.get('days')) || 7));

  const [usage, cards, keys, services] = await Promise.all([
    getRecentUsage(env, days),
    getCardIndex(env),
    getApiKeys(env),
    getProxyServices(env),
  ]);

  return ok({
    days,
    usage,
    summary: {
      cards: cards.length,
      keys: Object.keys(keys).length,
      proxyServices: Object.keys(services).length,
      callsToday: usage[0]?.total || 0,
      callsLast7Days: usage.slice(0, 7).reduce((sum, d) => sum + (d.total || 0), 0),
    },
  });
}
