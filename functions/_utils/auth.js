import { fail } from './http.js';

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function bearerToken(request) {
  const header = request.headers.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : header.trim();
}

export async function adminStatus(env) {
  const stored = await env.MOONAPI_KV.get('admin:token');
  return stored ? 'ready' : 'uninitialized';
}

export async function verifyAdmin(env, request) {
  const token = bearerToken(request);
  if (!token) return { ok: false, response: fail(40101, '缺少管理员令牌（Authorization: Bearer <token>）', 401) };
  const stored = await env.MOONAPI_KV.get('admin:token');
  if (!stored) return { ok: false, response: fail(50301, '管理员尚未初始化，请先调用 POST /api/admin/setup', 503) };
  if ((await sha256Hex(token)) !== stored) return { ok: false, response: fail(40102, '管理员令牌错误', 401) };
  return { ok: true };
}

export async function verifyApiKey(env, request) {
  const key = request.headers.get('x-api-key') || bearerToken(request);
  if (!key) return { ok: false, response: fail(40103, '缺少 API Key（Authorization: Bearer <key> 或 X-API-Key）', 401) };
  const raw = await env.MOONAPI_KV.get(`apikey:${key}`);
  if (!raw) return { ok: false, response: fail(40104, 'API Key 无效', 401) };
  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    return { ok: false, response: fail(40104, 'API Key 记录损坏', 401) };
  }
  if (record.status !== 'active') return { ok: false, response: fail(40302, 'API Key 已被吊销', 403) };
  return { ok: true, key, record };
}
