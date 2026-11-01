// Облачное хранилище данных приложения (Netlify Blobs). Один код доступа = один аккаунт.
// GET  -> {data, updated}      PUT -> сохраняет документ целиком, при конфликте отвечает 409 и отдаёт серверную копию.
import { createHash } from 'node:crypto';

const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const MAX = 1.5 * 1024 * 1024;

export function makeHandler(openStore) {
  return async (req) => {
    const codes = (process.env.ACCESS_CODES || '').split(',').map((s) => s.trim()).filter(Boolean);
    const given = (req.headers.get('x-access-code') || '').trim();
    if (!codes.length) return json(500, { error: 'setup' });
    if (!given || !codes.includes(given)) return json(401, { error: 'code' });
    const key = 'u/' + createHash('sha256').update('hv:' + given).digest('hex') + '.json';
    const store = await openStore();

    if (req.method === 'GET') {
      const cur = await store.get(key, { type: 'json' });
      return json(200, cur ? { data: cur.data, updated: cur.updated } : { data: null, updated: 0 });
    }
    if (req.method === 'PUT') {
      const raw = await req.text();
      if (raw.length > MAX) return json(413, { error: 'too_big' });
      let body;
      try { body = JSON.parse(raw); } catch { return json(400, { error: 'bad_request' }); }
      const data = body && body.data;
      if (!data || typeof data !== 'object' || !Array.isArray(data.meals)) return json(400, { error: 'bad_request' });
      const updated = Number(data.updated) || Date.now();
      const cur = await store.get(key, { type: 'json' });
      // Сервер новее и устройство о нём не знало: отдаём серверную копию, клиент сольёт данные.
      if (cur && cur.updated > updated && Number(body.base || 0) < cur.updated) return json(409, { data: cur.data, updated: cur.updated });
      await store.setJSON(key, { data, updated });
      return json(200, { ok: true, updated });
    }
    return json(405, { error: 'method' });
  };
}

export default async (req) => {
  const { getStore } = await import('@netlify/blobs');
  return makeHandler(async () => getStore({ name: 'hudeem', consistency: 'strong' }))(req);
};
