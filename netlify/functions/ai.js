// Прокси к бесплатному ИИ. Ключи лежат только в переменных окружения Netlify и не попадают на телефон.
// Нужен хотя бы один ключ: GEMINI_API_KEY (основной) и/или GROQ_API_KEY (запасной). Необязательно: ACCESS_CODES, GEMINI_MODEL, GROQ_MODEL.
const json = (status, obj) => ({ statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

function extract(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function viaGroq(text, image, max) {
  const content = [{ type: 'text', text }];
  if (image) content.push({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + image } });
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.GROQ_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'qwen/qwen3.8-27b',
      messages: [{ role: 'user', content }],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: max
    })
  });
  const j = await r.json().catch(() => ({}));
  const out = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  return { status: r.status, text: out };
}

// Gemini: сначала обычный Google AI Studio, при отказе по ключу пробуем Vertex AI (ключи вида AQ.…).
let gemMode = '';
async function gemCall(mode, model, text, image, max) {
  const parts = [{ text }];
  if (image) parts.push({ inline_data: { mime_type: 'image/jpeg', data: image } });
  const key = process.env.GEMINI_API_KEY;
  const url = mode === 'vertex'
    ? `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent?key=${encodeURIComponent(key)}`
    : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const headers = { 'Content-Type': 'application/json' };
  if (mode !== 'vertex') headers['x-goog-api-key'] = key;
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.2, maxOutputTokens: max, responseMimeType: 'application/json' } }) });
  const j = await r.json().catch(() => ({}));
  const out = (((j.candidates || [])[0] || {}).content || { parts: [] }).parts.map((p) => p.text || '').join('');
  return { status: r.status, text: out };
}
async function viaGemini(text, image, max) {
  const models = [process.env.GEMINI_MODEL, 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite', 'gemini-2.5-flash'].filter(Boolean);
  let last = { status: 502 }, tries = 0;
  for (const m of models) {
    const modes = gemMode === 'vertex' ? ['vertex', 'studio'] : ['studio', 'vertex'];
    for (const mode of modes) {
      if (tries++ >= 5) return last;
      last = await gemCall(mode, m, text, image, max);
      if (last.status >= 200 && last.status < 300) { gemMode = mode; return last; }
      if (last.status === 404) break;                 // такой модели нет, берём следующую
      if (last.status === 429) return last;
      if (![400, 401, 403].includes(last.status)) return last;
    }
  }
  return last;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method' });

  const codes = (process.env.ACCESS_CODES || '').split(',').map((s) => s.trim()).filter(Boolean);
  const given = (event.headers && (event.headers['x-access-code'] || event.headers['X-Access-Code'])) || '';
  if (codes.length && !codes.includes(String(given).trim())) return json(401, { error: 'code' });

  if (!process.env.GROQ_API_KEY && !process.env.GEMINI_API_KEY) return json(500, { error: 'setup' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad_request' }); }
  const text = String(body.text || '').slice(0, 9000);
  const max = Math.min(3000, Math.max(300, Number(body.max) || 1200));
  const image = body.image ? String(body.image) : '';
  if (!text) return json(400, { error: 'bad_request' });
  if (image.length > 4 * 1024 * 1024) return json(413, { error: 'too_big' });

  const order = [];
  if (process.env.GEMINI_API_KEY) order.push(viaGemini);
  if (process.env.GROQ_API_KEY) order.push(viaGroq);
  let res = { status: 502 }, data = null;
  for (const fn of order) {
    try { res = await fn(text, image, max); } catch { res = { status: 502 }; }
    if (res.status >= 200 && res.status < 300) { data = extract(res.text); if (data) break; res = { status: 502, parse: true }; }
  }
  if (data) return json(200, data);
  if (res.parse) return json(502, { error: 'parse' });
  if (res.status === 429) return json(429, { error: 'rate' });
  if ([400, 401, 403].includes(res.status)) return json(500, { error: 'setup' });
  return json(502, { error: 'upstream' });
};
