import { ok, fail, optionsResponse } from '../../_utils/http.js';
import { verifyAdmin, getApiKeys, saveApiKeys } from '../../_utils/auth.js';

export const onRequestOptions = () => optionsResponse();

function maskKey(key) {
  if (key.length <= 12) return key;
  return `${key.slice(0, 8)}${'•'.repeat(6)}${key.slice(-4)}`;
}

export async function onRequestGet({ request, env }) {
  const auth = await verifyAdmin(env, request);
  if (!auth.ok) return auth.response;

  const store = await getApiKeys(env);
  const keys = Object.entries(store).map(([fullKey, record]) => ({
    key: fullKey,
    masked: maskKey(fullKey),
    name: record?.name || '',
    status: record?.status || 'active',
    createdAt: record?.createdAt || null,
    dailyQuota: Number(record?.dailyQuota) || 0,
  }));
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

  const store = await getApiKeys(env);

  if (body?.action === 'revoke') {
    const key = String(body.key || '').trim();
    if (!key) return fail(40006, '缺少要吊销的 key', 400);
    if (!store[key]) return fail(40402, '该密钥不存在或已被吊销', 404);
    delete store[key];
    await saveApiKeys(env, store);
    return ok({ revoked: true });
  }

  const name = String(body?.name || '').trim().slice(0, 60) || '未命名应用';
  const dailyQuota = Math.max(0, Math.min(1000000, Number(body?.dailyQuota) || 0));
  const random = [...crypto.getRandomValues(new Uint8Array(24))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const key = `mk_live_${random}`;
  store[key] = { name, status: 'active', createdAt: new Date().toISOString(), dailyQuota };
  await saveApiKeys(env, store);
  return ok({ key, name, dailyQuota }, { message: 'API Key 已创建，完整 Key 仅此一次显示，请立即保存' });
}
