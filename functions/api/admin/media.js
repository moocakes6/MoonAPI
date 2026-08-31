import { ok, fail, optionsResponse } from '../../_utils/http.js';
import { verifyAdmin } from '../../_utils/auth.js';
import { readMeta, writeMeta } from '../../_utils/cards.js';

const MEDIA_INDEX_KEY = 'meta/media-index.json';
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export const onRequestOptions = () => optionsResponse();

async function getMediaIndex(env) {
  const index = await readMeta(env, MEDIA_INDEX_KEY, []);
  return Array.isArray(index) ? index : [];
}

export async function onRequestGet({ request, env }) {
  const auth = await verifyAdmin(env, request);
  if (!auth.ok) return auth.response;
  const index = await getMediaIndex(env);
  index.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return ok({ total: index.length, files: index });
}

export async function onRequestPost({ request, env }) {
  const auth = await verifyAdmin(env, request);
  if (!auth.ok) return auth.response;

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(40000, '请求体必须是合法 JSON', 400);
  }

  if (body?.action === 'delete') {
    const id = String(body.id || '');
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) return fail(40008, '非法的文件 ID', 400);
    await env.MOONAPI_R2.delete(`media/${id}`);
    const index = await getMediaIndex(env);
    await writeMeta(env, MEDIA_INDEX_KEY, index.filter((f) => f.id !== id));
    return ok({ deleted: id });
  }

  const base64 = String(body?.base64 || '');
  const contentType = String(body?.contentType || 'application/octet-stream');
  const name = String(body?.name || '未命名文件').slice(0, 120);
  if (!base64) return fail(40012, '缺少 base64 文件内容', 400);
  if (base64.length > MAX_UPLOAD_BYTES * 1.4) return fail(41301, '文件过大（上限 5MB）', 413);

  let bytes;
  try {
    const raw = atob(base64.replace(/\s/g, ''));
    bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  } catch {
    return fail(40013, 'base64 内容不合法', 400);
  }

  const id = crypto.randomUUID();
  await env.MOONAPI_R2.put(`media/${id}`, bytes, {
    httpMetadata: { contentType },
    customMetadata: { name },
  });

  const index = await getMediaIndex(env);
  index.push({ id, name, contentType, size: bytes.length, createdAt: new Date().toISOString() });
  await writeMeta(env, MEDIA_INDEX_KEY, index);
  return ok({ id, name, contentType, size: bytes.length, path: `/api/v1/media/${id}` }, { message: '文件已上传' });
}
