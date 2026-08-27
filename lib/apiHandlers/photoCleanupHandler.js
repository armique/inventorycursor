import { PHOTO_CLEANUP_PROMPT, parsePhotoCleanupResult } from '../photoCleanupPrompt.js';
import { getGeminiKeyForServer } from '../geminiServerEnv.js';
import { callGeminiVisionJson, formatGeminiVisionFailure } from '../geminiVisionClient.js';

/** One photo in, one crop/clutter/card-score suggestion out — same shape as the screenshot parsers. */
export async function handlePhotoCleanup(req, res) {
  const apiKey = getGeminiKeyForServer();
  if (!apiKey) {
    return res.status(500).json({
      error: 'Server missing Gemini API key. Add GEMINI_API_KEY on Vercel.',
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

  const { imageBase64, mimeType: mimeFromBody } = body;
  const mime = typeof mimeFromBody === 'string' && mimeFromBody.startsWith('image/') ? mimeFromBody : 'image/jpeg';
  const base64 = typeof imageBase64 === 'string' ? imageBase64.replace(/\s/g, '') : '';
  if (!base64) return res.status(400).json({ error: 'Provide imageBase64' });

  try {
    const { parsed } = await callGeminiVisionJson({
      apiKey,
      prompt: PHOTO_CLEANUP_PROMPT,
      mime,
      base64,
      maxOutputTokens: 256,
    });
    return res.status(200).json({ result: parsePhotoCleanupResult(parsed) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Gemini failed';
    console.error('photo-cleanup', e);
    return res.status(502).json({ error: msg.includes('Gemini') ? msg : formatGeminiVisionFailure([]) });
  }
}
