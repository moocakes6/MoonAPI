import { fail } from './http.js';
import { readMeta, writeMeta } from './cards.js';

const ADMIN_KEY = 'meta/admin-token.json';
const KEYS_KEY = 'meta/api-keys.json';

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function bearerToken(request) {
  const header = request.headers.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : header.trim();
}

export async function adminStatus(env) {
  const meta = await readMeta(env, ADMIN_KEY, null);
  return meta?.hash ? 'ready' : 'uninitialized';
}

export async function setAdminToken(env, token) {
  await writeMeta(env, ADMIN_KEY, {
    hash: await sha256Hex(token),
    createdAt: new Date().toISOString(),
  });
}

export async function verifyAdmin(env, request) {
  const token = bearerToken(request);
  if (!token) return { ok: false, response: fail(40101, '缺少管理员令牌（Authorization: Bearer <token>）', 401) };
  const meta = await readMeta(env, ADMIN_KEY, null);
  if (!meta?.hash) return { ok: false, response: fail(50301, '管理员尚未初始化，请先调用 POST /api/admin/setup', 503) };
  if ((await sha256Hex(token)) !== meta.hash) return { ok: false, response: fail(40102, '管理员令牌错误', 401) };
  return { ok: true };
}

export async function getApiKeys(env) {
  const keys = await readMeta(env, KEYS_KEY, {});
  return keys && typeof keys === 'object' && !Array.isArray(keys) ? keys : {};
}

export async function saveApiKeys(env, keys) {
  await writeMeta(env, KEYS_KEY, keys);
}

export async function verifyApiKey(env, request) {
  const key = request.headers.get('x-api-key') || bearerToken(request);
  if (!key) return { ok: false, response: fail(40103, '缺少 API Key（Authorization: Bearer <key> 或 X-API-Key）', 401) };
  const keys = await getApiKeys(env);
  const record = keys[key];
  if (!record) return { ok: false, response: fail(40104, 'API Key 无效', 401) };
  if (record.status !== 'active') return { ok: false, response: fail(40302, 'API Key 已被吊销', 403) };
  return { ok: true, key, record };
}
