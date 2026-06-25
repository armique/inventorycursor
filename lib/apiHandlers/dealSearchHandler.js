import { GoogleGenAI } from '@google/genai';
import { getGeminiKeyForServer } from '../geminiServerEnv.js';
import { MODEL_PRIORITY, runDealSearch } from '../dealSearchCore.js';

export async function handleDealSearch(req, res) {
  const apiKey = getGeminiKeyForServer();
  if (!apiKey) {
    return res.status(500).json({
      error:
        'Server missing Gemini API key. Add GEMINI_API_KEY on Vercel (Production) and redeploy.',
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

  if (!body.query || !String(body.query).trim()) {
    return res.status(400).json({ error: 'query is required' });
  }

  const criteria = {
    query: String(body.query).trim(),
    maxPrice: Number(body.maxPrice) || 0,
    platform: body.platform,
    includeEbay: body.includeEbay,
    customUrl: body.customUrl,
    excludeVB: body.excludeVB,
    excludeTausch: body.excludeTausch,
    plz: body.plz,
  };

  const ai = new GoogleGenAI({ apiKey });
  let lastError = null;

  for (const model of MODEL_PRIORITY) {
    try {
      const deals = await runDealSearch(ai, model, criteria);
      return res.status(200).json({ deals });
    } catch (e) {
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      const retry =
        msg.includes('429') ||
        msg.includes('exhausted') ||
        msg.includes('404') ||
        msg.includes('not found');
      if (retry) continue;
      break;
    }
  }

  const msg = lastError instanceof Error ? lastError.message : String(lastError || 'Search failed');
  return res.status(500).json({
    error: msg.includes('429') || msg.includes('exhausted')
      ? 'AI quota exceeded. Try again later.'
      : `Search failed: ${msg}`,
  });
}
