import { fail, optionsResponse } from '../../../_utils/http.js';

export const onRequestOptions = () => optionsResponse();

export async function onRequestGet({ env, params }) {
  const id = String(params.id || '');
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) return fail(40008, '非法的文件 ID', 400);

  const obj = await env.MOONAPI_R2.get(`media/${id}`);
  if (!obj) return fail(40404, '文件不存在', 404);

  const headers = {
    'content-type': obj.httpMetadata?.contentType || 'application/octet-stream',
    'cache-control': 'public, max-age=86400, immutable',
    'access-control-allow-origin': '*',
  };
  return new Response(obj.body, { status: 200, headers });
}
