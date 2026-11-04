// Подписка на push-напоминания и их настройки. Хранится рядом с данными пользователя.
//   GET    -> {settings, subs}          PUT {subscription, settings} -> сохраняет
//   DELETE {endpoint} -> отписка        POST {test:true} -> тестовое уведомление сейчас
import { json, auth, realStore } from '../lib/common.mjs';

export const DEFAULTS = { tz: 'Europe/Minsk', water: true, waterTimes: ['11:00', '15:00', '19:00'], meals: true, workout: true, workoutTime: '18:00', workoutDays: [1, 3, 5], weigh: true };

export async function sendPush(sub, payload) {
  const webpush = (await import('web-push')).default;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://hudeem-vmeste-app.netlify.app', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  return webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 3600 });
}

export function makeHandler(openStore, send = sendPush) {
  return async (req) => {
    const a = auth(req); if (a.err) return a.err;
    const store = await openStore(), key = 'p/' + a.id + '.json', rec = (await store.get(key, { type: 'json' })) || { subs: [], settings: DEFAULTS, sent: {} };
    if (req.method === 'GET') return json(200, { settings: Object.assign({}, DEFAULTS, rec.settings), subs: rec.subs.length, ready: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) });
    let b = {}; try { b = await req.json(); } catch {}
    if (req.method === 'PUT') {
      const sub = b.subscription;
      if (sub && sub.endpoint && sub.keys) { rec.subs = rec.subs.filter((s) => s.endpoint !== sub.endpoint); rec.subs.push(sub); rec.subs = rec.subs.slice(-5); }
      if (b.settings && typeof b.settings === 'object') {
        const s = b.settings, t = (x) => (/^\d{2}:\d{2}$/.test(String(x)) ? String(x) : null);
        rec.settings = { tz: String(s.tz || DEFAULTS.tz).slice(0, 60), water: !!s.water, waterTimes: (Array.isArray(s.waterTimes) ? s.waterTimes : DEFAULTS.waterTimes).map(t).filter(Boolean).slice(0, 8), meals: !!s.meals, workout: !!s.workout,
          workoutTime: t(s.workoutTime) || DEFAULTS.workoutTime, workoutDays: (Array.isArray(s.workoutDays) ? s.workoutDays : []).map(Number).filter((n) => n >= 0 && n <= 6).slice(0, 7), weigh: !!s.weigh };
      }
      await store.setJSON(key, rec); return json(200, { ok: true, subs: rec.subs.length });
    }
    if (req.method === 'DELETE') { rec.subs = rec.subs.filter((s) => s.endpoint !== b.endpoint); await store.setJSON(key, rec); return json(200, { ok: true, subs: rec.subs.length }); }
    if (req.method === 'POST' && b.test) {
      if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return json(500, { error: 'setup' });
      let ok = 0; for (const s of rec.subs.slice()) { try { await send(s, { title: 'Худеем вместе', body: 'Напоминания работают.', tag: 'test' }); ok++; } catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) rec.subs = rec.subs.filter((x) => x.endpoint !== s.endpoint); } }
      await store.setJSON(key, rec); return json(200, { ok, subs: rec.subs.length });
    }
    return json(405, { error: 'method' });
  };
}
export default async (req) => makeHandler(realStore)(req);
