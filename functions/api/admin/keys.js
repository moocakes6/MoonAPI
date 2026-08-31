import { ok, fail, optionsResponse } from '../../_utils/http.js';
import { verifyAdmin } from '../../_utils/auth.js';

export const onRequestOptions = () => optionsResponse();

function maskKey(key) {
  if (key.length <= 12) return key;
  return `${key.slice(0, 8)}${'•'.repeat(6)}${key.slice(-4)}`;
}

export async function onRequestGet({ request, env }) {
  const auth = await verifyAdmin(env, request);
  if (!auth.ok) return auth.response;

  const keys = [];
  let cursor;
  do {
    const page = await env.MOONAPI_KV.list({ prefix: 'apikey:', cursor });
    for (const entry of page.keys) {
      let record = {};
      try {
        record = JSON.parse(await env.MOONAPI_KV.get(entry.name)) || {};
      } catch {}
      const fullKey = entry.name.slice(7);
      keys.push({
        key: fullKey,
        masked: maskKey(fullKey),
        name: record.name || '',
        status: record.status || 'active',
        createdAt: record.createdAt || null,
      });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  keys.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return ok({ total: keys.length, keys });
}

export async function onRequestPost({ request, env }) {
  const auth = await verifyAdmin(env, request);
  if (!auth.ok) return auth.response;

  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  if (body?.action === 'revoke') {
    const key = String(body.key || '').trim();
    if (!key) return fail(40006, '缺少要吊销的 key', 400);
    await env.MOONAPI_KV.delete(`apikey:${key}`);
    return ok({ revoked: true });
  }

  const name = String(body?.name || '').trim().slice(0, 60) || '未命名应用';
  const random = [...crypto.getRandomValues(new Uint8Array(24))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const key = `mk_live_${random}`;
  await env.MOONAPI_KV.put(
    `apikey:${key}`,
    JSON.stringify({ name, status: 'active', createdAt: new Date().toISOString() })
  );
  return ok({ key, name }, { message: 'API Key 已创建，完整 Key 仅此一次显示，请立即保存' });
}
