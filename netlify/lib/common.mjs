// Общие помощники для функций: ответы, проверка кода доступа, ключ пользователя, хранилище.
import { createHash } from 'node:crypto';

export const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
export const codesList = () => (process.env.ACCESS_CODES || '').split(',').map((s) => s.trim()).filter(Boolean);
export const idOf = (code) => createHash('sha256').update('hv:' + code).digest('hex');

// Код берём из заголовка x-access-code или из ?code= (для «Команд» iPhone).
export function auth(req) {
  const list = codesList();
  if (!list.length) return { err: json(500, { error: 'setup' }) };
  const given = (req.headers.get('x-access-code') || new URL(req.url).searchParams.get('code') || '').trim();
  if (!given || !list.includes(given)) return { err: json(401, { error: 'code' }) };
  return { code: given, id: idOf(given) };
}

export async function realStore() {
  const { getStore } = await import('@netlify/blobs');
  return getStore({ name: 'hudeem', consistency: 'strong' });
}

export const todayIn = (tz = 'Europe/Minsk', d = new Date()) => {
  try { return new Intl.DateTimeFormat('sv-SE', { timeZone: tz }).format(d); } catch { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Minsk' }).format(d); }
};
export const addDaysStr = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
