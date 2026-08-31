import { ok, fail, optionsResponse } from '../../../_utils/http.js';
import { verifyAdmin } from '../../../_utils/auth.js';
import { getCardIndex, saveCardIndex, deleteCard } from '../../../_utils/cards.js';

export const onRequestOptions = () => optionsResponse();

export async function onRequestPost({ request, env }) {
  const auth = await verifyAdmin(env, request);
  if (!auth.ok) return auth.response;

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(40000, '请求体必须是合法 JSON', 400);
  }
  const ids = Array.isArray(body?.ids) ? body.ids.map(String) : [];
  if (ids.length === 0 || ids.length > 500) return fail(40005, 'ids 需在 1-500 条之间', 400);

  for (const id of ids) await deleteCard(env, id);
  const index = await getCardIndex(env);
  await saveCardIndex(env, index.filter((c) => !ids.includes(c.id)));
  return ok({ deleted: ids.length });
}
