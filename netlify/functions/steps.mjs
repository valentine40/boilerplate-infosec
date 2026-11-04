// Шаги из «Здоровья»: «Команда» на iPhone шлёт число шагов, приложение его забирает.
//   GET/POST /.netlify/functions/steps?code=КОД&steps=7421[&date=2026-11-04][&tz=Europe/Minsk]  -> сохраняет
//   GET      /.netlify/functions/steps  (заголовок x-access-code)                              -> отдаёт последние дни
import { json, auth, idOf, realStore, todayIn, addDaysStr } from '../lib/common.mjs';

export function makeHandler(openStore) {
  return async (req) => {
    const a = auth(req); if (a.err) return a.err;
    const url = new URL(req.url), store = await openStore(), key = 's/' + a.id + '.json';
    const cur = (await store.get(key, { type: 'json' })) || { days: {} };
    let steps = url.searchParams.get('steps');
    if (steps === null && req.method === 'POST') { try { const b = await req.json(); if (b && b.steps !== undefined) steps = String(b.steps); } catch {} }
    if (steps !== null) {
      if (!/\d/.test(steps)) return json(400, { error: 'bad_steps' });
      const n = Math.round(Number(String(steps).replace(/[^\d.]/g, '')));
      if (!Number.isFinite(n) || n < 0 || n > 200000) return json(400, { error: 'bad_steps' });
      const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('date') || '') ? url.searchParams.get('date') : todayIn(url.searchParams.get('tz') || 'Europe/Minsk');
      cur.days[date] = n;
      const keep = Object.keys(cur.days).sort().slice(-60); cur.days = Object.fromEntries(keep.map((d) => [d, cur.days[d]]));
      await store.setJSON(key, cur);
      return json(200, { ok: true, date, steps: n });
    }
    return json(200, { days: cur.days });
  };
}
export default async (req) => makeHandler(realStore)(req);
