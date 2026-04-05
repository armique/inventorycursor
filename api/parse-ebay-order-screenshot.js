/**
 * Vercel serverless: parse eBay order screenshot with Gemini (vision).
 * POST JSON: { imageUrl?: string } OR { imageBase64: string, mimeType?: string }
 * Uses VITE_GEMINI_API_KEY or VITE_API_KEY or GEMINI_API_KEY from project env.
 * Fetches remote images server-side (fixes Imgur / CORS for the browser).
 */
import { EBAY_ORDER_SCREENSHOT_EXTRACTION_PROMPT } from '../lib/ebayOrderScreenshotPrompt.js';

/** Order: prefer 2.x; fall back when quota/model unavailable (see models.list API). */
const GEMINI_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-2.0-flash-001',
  'gemini-2.0-flash-lite',
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey =
    process.env.VITE_GEMINI_API_KEY?.trim() ||
    process.env.VITE_API_KEY?.trim() ||
    process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return res.status(500).json({
      error: 'Server missing Gemini key. Set VITE_GEMINI_API_KEY in Vercel Environment Variables.',
    });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}');
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
  }
  body = body || {};

  const { imageUrl, imageBase64, mimeType: mimeFromBody } = body;

  let mime = typeof mimeFromBody === 'string' && mimeFromBody.startsWith('image/') ? mimeFromBody : 'image/jpeg';
  let base64 = typeof imageBase64 === 'string' ? imageBase64.replace(/\s/g, '') : '';

  if (imageUrl && typeof imageUrl === 'string') {
    try {
      const r = await fetch(imageUrl.trim(), { redirect: 'follow' });
      if (!r.ok) {
        return res.status(400).json({ error: `Could not download image (HTTP ${r.status}).` });
      }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 12 * 1024 * 1024) {
        return res.status(400).json({ error: 'Image too large (max ~12MB).' });
      }
      base64 = buf.toString('base64');
      const ct = r.headers.get('content-type');
      if (ct && /^image\//i.test(ct.split(';')[0].trim())) {
        mime = ct.split(';')[0].trim();
      }
    } catch (e) {
      return res.status(400).json({
        error: e instanceof Error ? e.message : 'Image download failed',
      });
    }
  }

  if (!base64) {
    return res.status(400).json({ error: 'Provide imageUrl or imageBase64' });
  }

  const geminiBody = {
    contents: [
      {
        parts: [
          { text: EBAY_ORDER_SCREENSHOT_EXTRACTION_PROMPT },
          {
            inlineData: {
              mimeType: mime,
              data: base64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
      maxOutputTokens: 1024,
    },
  };

  try {
    let lastErr = '';
    for (const model of GEMINI_MODELS) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const gRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiBody),
      });

      const rawText = await gRes.text();
      if (!gRes.ok) {
        lastErr = rawText.slice(0, 400);
        if (gRes.status === 404 || gRes.status === 429) continue;
        console.error('Gemini API error', model, gRes.status, lastErr);
        return res.status(502).json({
          error: `Gemini API ${gRes.status}: ${lastErr.slice(0, 200)}`,
        });
      }

      let data;
      try {
        data = JSON.parse(rawText);
      } catch {
        return res.status(502).json({ error: 'Invalid response from Gemini' });
      }

      const candidate = data.candidates?.[0];
      if (!candidate) {
        const block = data.promptFeedback?.blockReason || 'unknown';
        lastErr = `block: ${block}`;
        continue;
      }

      const text = candidate.content?.parts?.[0]?.text?.trim() || '{}';
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        return res.status(422).json({ error: 'Gemini returned non-JSON' });
      }

      const o = parsed && typeof parsed === 'object' ? parsed : {};
      const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
      const parsedOut = {
        ebayOrderId: str(o.ebayOrderId),
        ebayUsername: str(o.ebayUsername),
        buyerFullName: str(o.buyerFullName),
        shippingAddress: str(o.shippingAddress),
        phone: str(o.phone) ?? undefined,
      };

      return res.status(200).json({ parsed: parsedOut });
    }

    return res.status(502).json({
      error: `Gemini: all models failed. Last: ${lastErr.slice(0, 280)}`,
    });
  } catch (e) {
    console.error('parse-ebay-order-screenshot', e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Server error',
    });
  }
}
