import { ok, fail, optionsResponse } from '../../_utils/http.js';
import { sha256Hex } from '../../_utils/auth.js';

export const onRequestOptions = () => optionsResponse();

export async function onRequestPost({ request, env }) {
  const existing = await env.MOONAPI_KV.get('admin:token');
  if (existing) return fail(40901, '管理员已初始化，无法重复设置', 409);

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(40000, '请求体必须是合法 JSON', 400);
  }
  const token = String(body?.token || '').trim();
  if (token.length < 8) return fail(40002, '管理员令牌至少 8 个字符', 400);

  await env.MOONAPI_KV.put('admin:token', await sha256Hex(token));
  return ok({ initialized: true }, { message: '管理员初始化成功，请妥善保管令牌' });
}
