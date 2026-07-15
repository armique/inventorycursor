import dotenv from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const key =
  process.env.GEMINI_API_KEY?.trim() ||
  process.env.VITE_GEMINI_API_KEY?.trim() ||
  process.env.VITE_API_KEY?.trim();
if (!key) {
  console.error('No Gemini key');
  process.exit(1);
}

const b64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const models = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
  'gemini-flash-latest',
  'gemini-2.0-flash-001',
];

for (const model of models) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: 'Return JSON {"ok":true}' },
            { inlineData: { mimeType: 'image/png', data: b64 } },
          ],
        },
      ],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 64 },
    }),
  });
  const raw = await res.text();
  console.log(model, '→', res.status, res.ok ? 'OK' : raw.slice(0, 100).replace(/\s+/g, ' '));
}
