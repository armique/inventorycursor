import {
  KLEINANZEIGEN_CHAT_SCREENSHOT_EXTRACTION_PROMPT,
  parseExtractedSaleDate,
} from '../kleinanzeigenChatScreenshotPrompt.js';
import { getGeminiKeyForServer } from '../geminiServerEnv.js';
import { callGeminiVisionJson, formatGeminiVisionFailure } from '../geminiVisionClient.js';

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

  try {
    const { parsed: o } = await callGeminiVisionJson({
      apiKey,
      prompt: KLEINANZEIGEN_CHAT_SCREENSHOT_EXTRACTION_PROMPT,
      mime,
      base64,
    });
    const row = o && typeof o === 'object' ? o : {};
    const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const price = (() => {
      const v = row.agreedPriceEur;
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
        buyerName: str(row.buyerName),
        agreedPriceEur: price,
        paymentMethod: str(row.paymentMethod),
        saleDate: parseExtractedSaleDate(row.saleDate),
        chatUrl: str(row.chatUrl),
        itemTitle: str(row.itemTitle),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Gemini failed';
    console.error('ka-screenshot', e);
    return res.status(502).json({ error: msg.includes('Gemini') ? msg : formatGeminiVisionFailure([]) });
  }
}
