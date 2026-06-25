import {
  KLEINANZEIGEN_CHAT_SCREENSHOT_EXTRACTION_PROMPT,
  parseExtractedSaleDate,
} from '../kleinanzeigenChatScreenshotPrompt.js';
import { getGeminiKeyForServer } from '../geminiServerEnv.js';

const GEMINI_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-2.0-flash-001',
  'gemini-2.0-flash-lite',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function handleKaScreenshot(req, res) {
  const apiKey = getGeminiKeyForServer();
  if (!apiKey) {
    return res.status(500).json({ error: 'Server missing Gemini API key. Add GEMINI_API_KEY on Vercel.' });
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
      if (!r.ok) return res.status(400).json({ error: `Could not download image (HTTP ${r.status}).` });
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 12 * 1024 * 1024) return res.status(400).json({ error: 'Image too large (max ~12MB).' });
      base64 = buf.toString('base64');
      const ct = r.headers.get('content-type');
      if (ct && /^image\//i.test(ct.split(';')[0].trim())) mime = ct.split(';')[0].trim();
    } catch (e) {
      return res.status(400).json({ error: e instanceof Error ? e.message : 'Image download failed' });
    }
  }

  if (!base64) return res.status(400).json({ error: 'Provide imageUrl or imageBase64' });

  const geminiBody = {
    contents: [{ parts: [{ text: KLEINANZEIGEN_CHAT_SCREENSHOT_EXTRACTION_PROMPT }, { inlineData: { mimeType: mime, data: base64 } }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 1024 },
  };

  try {
    let lastErr = '';
    for (const model of GEMINI_MODELS) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const gRes = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(geminiBody) });
        const rawText = await gRes.text();
        if (!gRes.ok) {
          lastErr = rawText.slice(0, 400);
          if (gRes.status === 404) break;
          if ((gRes.status === 429 || gRes.status === 500 || gRes.status === 503) && attempt < 3) {
            await sleep(250 * attempt);
            continue;
          }
          break;
        }
        let data;
        try {
          data = JSON.parse(rawText);
        } catch {
          return res.status(502).json({ error: 'Invalid response from Gemini' });
        }
        const candidate = data.candidates?.[0];
        if (!candidate) {
          lastErr = `block: ${data.promptFeedback?.blockReason || 'unknown'}`;
          break;
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
        const netEur = (() => {
          const v = o.agreedPriceEur;
          if (typeof v === 'number' && Number.isFinite(v)) return v;
          if (typeof v === 'string') {
            const t = v.trim().replace(/€/g, '').replace(/\s/g, '').replace(',', '.');
            const n = parseFloat(t);
            return Number.isFinite(n) ? n : null;
          }
          return null;
        })();
        return res.status(200).json({
          parsed: {
            buyerName: str(o.buyerName),
            agreedPriceEur: netEur,
            paymentMethod: str(o.paymentMethod),
            saleDate: parseExtractedSaleDate(o.saleDate),
            chatUrl: str(o.chatUrl),
            itemTitle: str(o.itemTitle),
          },
        });
      }
    }
    return res.status(502).json({ error: `Gemini failed: ${lastErr.slice(0, 280)}` });
  } catch (e) {
    console.error('ka-screenshot', e);
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Server error' });
  }
}
