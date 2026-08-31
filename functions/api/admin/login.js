import { ok, optionsResponse } from '../../_utils/http.js';
import { verifyAdmin } from '../../_utils/auth.js';

export const onRequestOptions = () => optionsResponse();

export async function onRequestPost({ request, env }) {
  const auth = await verifyAdmin(env, request);
  if (!auth.ok) return auth.response;
  return ok({ authenticated: true });
}
