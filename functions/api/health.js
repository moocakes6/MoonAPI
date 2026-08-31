import { json, optionsResponse } from '../_utils/http.js';

export const onRequestOptions = () => optionsResponse();

export async function onRequestGet({ env }) {
  const bindings = { kv: false, r2: false };
  try {
    await env.MOONAPI_KV.list({ limit: 1 });
    bindings.kv = true;
  } catch {}
  try {
    await env.MOONAPI_R2.list({ limit: 1 });
    bindings.r2 = true;
  } catch {}
  return json({
    code: 0,
    message: 'ok',
    data: {
      service: 'MoonAPI',
      version: '1.0.0',
      time: new Date().toISOString(),
      bindings,
      endpoints: ['/api/v1/daily-card', '/api/admin/*', '/admin', '/docs'],
    },
  });
}
