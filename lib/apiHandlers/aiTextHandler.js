/**
 * Server-side text/JSON generation for Parse AI + listing copy.
 * Uses GEMINI_API_KEY / GROQ_API_KEY / OPENAI_API_KEY (no VITE_ required).
 */
import { getServerAIKeys, listConfiguredServerProviders } from '../serverAIEnv.js';

const GEMINI_MODELS = ['gemini-2.0-flash-lite', 'gemini-2.0-flash'];

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function callGroq(key, prompt, maxTokens, json) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Groq ${res.status}`);
  return String(data.choices?.[0]?.message?.content || '').trim();
}

async function callOpenAI(key, prompt, maxTokens, json) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `OpenAI ${res.status}`);
  return String(data.choices?.[0]?.message?.content || '').trim();
}

async function callGemini(key, prompt, maxTokens, json) {
  let lastError = new Error('Gemini: no model succeeded');
  for (const model of GEMINI_MODELS) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: maxTokens,
            ...(json ? { responseMimeType: 'application/json' } : {}),
          },
        }),
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      lastError = new Error(data.error?.message || `Gemini ${res.status}`);
      continue;
    }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) return String(text).trim();
  }
  throw lastError;
}

async function callTogether(key, prompt, maxTokens) {
  const res = await fetch('https://api.together.xyz/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'meta-llama/Llama-3.2-3B-Instruct-Turbo',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Together ${res.status}`);
  return String(data.choices?.[0]?.message?.content || '').trim();
}

async function callMistral(key, prompt, maxTokens) {
  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'mistral-small-latest',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Mistral ${res.status}`);
  return String(data.choices?.[0]?.message?.content || '').trim();
}

export async function handleAiText(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({ providers: listConfiguredServerProviders() });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const prompt = String(body.prompt || '').trim();
  if (prompt.length < 3) {
    return res.status(400).json({ error: 'prompt required' });
  }
  const json = body.mode === 'json' || body.json === true;
  const maxTokens = Math.min(4096, Math.max(64, Number(body.maxTokens) || 1024));

  const keys = getServerAIKeys();
  const attempts = [
    keys.groq && ((p) => callGroq(keys.groq, p, maxTokens, json)),
    keys.gemini && ((p) => callGemini(keys.gemini, p, maxTokens, json)),
    keys.openai && ((p) => callOpenAI(keys.openai, p, maxTokens, json)),
    keys.together && ((p) => callTogether(keys.together, p, maxTokens)),
    keys.mistral && ((p) => callMistral(keys.mistral, p, maxTokens)),
  ].filter(Boolean);

  if (!attempts.length) {
    return res.status(503).json({
      error:
        'No AI configured on the server. Add GEMINI_API_KEY, GROQ_API_KEY or OPENAI_API_KEY to .env and restart npm run dev.',
    });
  }

  let lastError = 'All server AI providers failed';
  for (const run of attempts) {
    try {
      const text = await run(prompt);
      if (text) return res.status(200).json({ text });
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  return res.status(502).json({ error: lastError });
}
