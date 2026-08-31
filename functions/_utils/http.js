export const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, x-api-key',
  'access-control-max-age': '86400',
};

export function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 0), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

export function ok(data, extra = {}) {
  return json({ code: 0, message: 'success', data, requestId: crypto.randomUUID(), ...extra });
}

export function fail(code, message, status) {
  return json({ code, message, requestId: crypto.randomUUID() }, status);
}

export function optionsResponse() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function todayCN(offsetDays = 0) {
  const d = new Date(Date.now() + (8 + offsetDays * 24) * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
