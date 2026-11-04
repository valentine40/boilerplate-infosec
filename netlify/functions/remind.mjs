// Запускается по расписанию каждые 15 минут: шлёт напоминания тем, у кого они включены и дело ещё не сделано.
import { realStore } from '../lib/common.mjs';
import { DEFAULTS, sendPush } from './push.mjs';

export const config = { schedule: '*/15 * * * *' };

const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
function localParts(tz, now) {
  const f = (o) => new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: tz }, o)).format(now);
  let date; try { date = new Intl.DateTimeFormat('sv-SE', { timeZone: tz }).format(now); } catch { tz = DEFAULTS.tz; date = new Intl.DateTimeFormat('sv-SE', { timeZone: tz }).format(now); }
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now).split(':').map(Number);
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now));
  return { date, min: h * 60 + m, dow };
}

// Что отправить прямо сейчас этому человеку: [{id, title, body}]
export function due(settings, doc, now) {
  const s = Object.assign({}, DEFAULTS, settings), { date, min, dow } = localParts(s.tz, now), d = (doc && doc.data) || {}, out = [];
  const inWindow = (t) => { const x = min - toMin(t); return x >= 0 && x < 20; };
  const meals = (d.meals || []).filter((m) => m.date === date), has = (k) => meals.some((m) => m.meal === k);
  if (s.water && s.waterTimes.some(inWindow) && ((d.days && d.days[date] && d.days[date].water) || 0) < 8) out.push({ id: 'water@' + s.waterTimes.find(inWindow), title: 'Вода', body: 'Выпейте стакан воды и отметьте в приложении.' });
  if (s.meals) [['10:30', 'breakfast', 'завтрак'], ['14:30', 'lunch', 'обед'], ['20:00', 'dinner', 'ужин']].forEach(([t, k, n]) => { if (inWindow(t) && !has(k)) out.push({ id: 'meal@' + k, title: 'Дневник питания', body: `Не забудьте записать ${n}.` }); });
  if (s.workout && s.workoutDays.includes(dow) && inWindow(s.workoutTime) && !(d.workouts || []).some((w) => w.date === date)) out.push({ id: 'workout', title: 'Тренировка', body: 'Время для тренировки. Загляните в план на сегодня.' });
  if (s.weigh && dow === 1 && inWindow('08:00') && !(d.weights || []).some((w) => w.date >= addDays(date, -5))) out.push({ id: 'weigh', title: 'Взвешивание', body: 'Новая неделя. Запишите вес утром натощак.' });
  return { date, out };
}
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export async function run({ store, send = sendPush, now = new Date() }) {
  const { blobs } = await store.list({ prefix: 'p/' }); let sent = 0;
  for (const b of blobs) {
    const rec = await store.get(b.key, { type: 'json' }); if (!rec || !rec.subs || !rec.subs.length) continue;
    const id = b.key.slice(2, -5), doc = await store.get('u/' + id + '.json', { type: 'json' }), { date, out } = due(rec.settings, doc, now);
    rec.sent = { [date]: (rec.sent && rec.sent[date]) || [] }; let changed = false;
    for (const n of out) {
      if (rec.sent[date].includes(n.id)) continue;
      rec.sent[date].push(n.id); changed = true;
      for (const s of rec.subs.slice()) { try { await send(s, { title: n.title, body: n.body, tag: n.id, url: './' }); sent++; } catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) rec.subs = rec.subs.filter((x) => x.endpoint !== s.endpoint); } }
    }
    if (changed) await store.setJSON(b.key, rec);
  }
  return sent;
}
export default async () => { await run({ store: await realStore() }); };
