/**
 * Verifies Gemini vision JSON uses camelCase inlineData (same as app + Vercel API).
 * Run: node scripts/test-gemini-vision-ebay.mjs
 */
import dotenv from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { EBAY_ORDER_SCREENSHOT_EXTRACTION_PROMPT } from '../lib/ebayOrderScreenshotPrompt.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const key = process.env.VITE_GEMINI_API_KEY?.trim() || process.env.VITE_API_KEY?.trim();
if (!key) {
  console.error('Missing VITE_GEMINI_API_KEY (or VITE_API_KEY) in .env');
  process.exit(1);
}

const tinyPngB64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const models = [
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-2.0-flash-001',
  'gemini-2.0-flash-lite',
];
const payload = {
  contents: [
    {
      parts: [
        {
          text:
            EBAY_ORDER_SCREENSHOT_EXTRACTION_PROMPT +
            '\n\nNote: If the image has no order UI, return all JSON fields as null.',
        },
        { inlineData: { mimeType: 'image/png', data: tinyPngB64 } },
      ],
    },
  ],
  generationConfig: {
    responseMimeType: 'application/json',
    temperature: 0.1,
    maxOutputTokens: 512,
  },
};

for (const model of models) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const raw = await res.text();
  if (!res.ok) {
    console.warn(model, '→', res.status, raw.slice(0, 120));
    continue;
  }
  const data = JSON.parse(raw);
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    console.warn(model, '→ no candidate');
    continue;
  }
  const parsed = JSON.parse(text);
  console.log('Gemini vision OK via', model, 'keys:', Object.keys(parsed));
  process.exit(0);
}
console.error('All models failed (quota or API). Fix key/billing in Google AI Studio.');
process.exit(1);
