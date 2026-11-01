// Прокси к бесплатному ИИ. Ключи лежат только в переменных окружения Netlify и не попадают на телефон.
// Нужно: GROQ_API_KEY (или GEMINI_API_KEY как запасной). Необязательно: ACCESS_CODES="код1,код2", GROQ_MODEL.
const json = (status, obj) => ({ statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

function extract(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function viaGroq(text, image) {
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
      max_tokens: 1200
    })
  });
  const j = await r.json().catch(() => ({}));
  const out = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  return { status: r.status, text: out };
}

async function viaGemini(text, image) {
  const parts = [{ text }];
  if (image) parts.push({ inline_data: { mime_type: 'image/jpeg', data: image } });
  let last = { status: 502 };
  for (const m of ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite']) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } })
    });
    if (r.status === 404) { last = { status: 404 }; continue; }
    const j = await r.json().catch(() => ({}));
    const out = (((j.candidates || [])[0] || {}).content || { parts: [] }).parts.map((p) => p.text || '').join('');
    return { status: r.status, text: out };
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
  const text = String(body.text || '').slice(0, 4000);
  const image = body.image ? String(body.image) : '';
  if (!text) return json(400, { error: 'bad_request' });
  if (image.length > 4 * 1024 * 1024) return json(413, { error: 'too_big' });

  let res;
  try { res = process.env.GROQ_API_KEY ? await viaGroq(text, image) : await viaGemini(text, image); }
  catch { return json(502, { error: 'upstream' }); }

  if (res.status === 429) return json(429, { error: 'rate' });
  if (res.status === 401 || res.status === 403) return json(500, { error: 'setup' });
  if (res.status < 200 || res.status >= 300) return json(502, { error: 'upstream' });
  const data = extract(res.text);
  if (!data) return json(502, { error: 'parse' });
  return json(200, data);
};
