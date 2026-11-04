// «Вместе»: сводка другого профиля за неделю и сообщения поддержки.
//   GET  ?with=КОД_ДРУГОГО&today=2026-11-04   -> {peer:{...сводка}, cheers:[...для меня]}
//   POST {to:КОД, text, from}                 -> оставляет сообщение для другого профиля
import { json, auth, idOf, codesList, realStore, addDaysStr } from '../lib/common.mjs';

export function summarize(doc, today) {
  const d = (doc && doc.data) || null; if (!d) return { empty: true };
  const meals = d.meals || [], wk = d.workouts || [], ws = (d.weights || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const days = [...Array(7)].map((_, i) => addDaysStr(today, i - 6));
  const kcalOn = (date) => meals.filter((m) => m.date === date).reduce((a, m) => a + (m.k * m.g) / 100, 0);
  const logged = days.filter((x) => meals.some((m) => m.date === x)), kc = logged.map(kcalOn);
  let streak = 0, c = today; if (!meals.some((m) => m.date === c)) c = addDaysStr(c, -1); while (meals.some((m) => m.date === c)) { streak++; c = addDaysStr(c, -1); }
  const w7 = wk.filter((w) => w.date >= days[0] && w.date <= today), first = ws[0], last = ws[ws.length - 1], ago = ws.filter((w) => w.date <= addDaysStr(today, -28)).pop();
  return { name: (d.profile && d.profile.name) || '', goalType: (d.profile && d.profile.goalType) || '', goal: (d.profile && d.profile.goal) || 0,
    daysLogged: logged.length, avgKcal: kc.length ? Math.round(kc.reduce((a, b) => a + b, 0) / kc.length) : 0, perDay: days.map((x, i) => ({ d: x, logged: logged.includes(x), kcal: Math.round(kcalOn(x)) })),
    workouts: w7.length, workoutMin: w7.reduce((a, w) => a + (w.min || 0), 0), streak, weightNow: last ? last.kg : null, weightChangeTotal: first && last ? Math.round((last.kg - first.kg) * 10) / 10 : null,
    weightChange4w: ago && last ? Math.round((last.kg - ago.kg) * 10) / 10 : null, updated: doc.updated || 0 };
}

export function makeHandler(openStore) {
  return async (req) => {
    const a = auth(req); if (a.err) return a.err;
    const store = await openStore(), list = codesList(), url = new URL(req.url);
    if (req.method === 'GET') {
      const other = (url.searchParams.get('with') || '').trim(); if (!list.includes(other) || other === a.code) return json(400, { error: 'bad_peer' });
      const today = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('today') || '') ? url.searchParams.get('today') : new Date().toISOString().slice(0, 10);
      const doc = await store.get('u/' + idOf(other) + '.json', { type: 'json' }), cheers = (await store.get('c/' + a.id + '.json', { type: 'json' })) || [];
      return json(200, { peer: summarize(doc, today), cheers });
    }
    if (req.method === 'POST') {
      let b; try { b = await req.json(); } catch { return json(400, { error: 'bad_request' }); }
      const to = String((b && b.to) || '').trim(), text = String((b && b.text) || '').trim().slice(0, 80);
      if (!list.includes(to) || to === a.code || !text) return json(400, { error: 'bad_request' });
      const key = 'c/' + idOf(to) + '.json', cur = (await store.get(key, { type: 'json' })) || [];
      cur.push({ from: String((b && b.from) || '').slice(0, 30), text, at: Date.now() });
      await store.setJSON(key, cur.slice(-30));
      return json(200, { ok: true });
    }
    return json(405, { error: 'method' });
  };
}
export default async (req) => makeHandler(realStore)(req);
