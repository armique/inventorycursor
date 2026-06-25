/**
 * Server-side deal search (Deal Hunter). Uses GEMINI_API_KEY on Vercel.
 * POST JSON: SavedSearchCriteria fields { query, maxPrice, platform, includeEbay, customUrl }
 */
import { GoogleGenAI } from '@google/genai';
import { getGeminiKeyForServer } from './geminiServerEnv.js';
import { MODEL_PRIORITY, runDealSearch } from '../lib/dealSearchCore.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = getGeminiKeyForServer();
  if (!apiKey) {
    return res.status(500).json({
      error:
        'Server missing Gemini API key. Add GEMINI_API_KEY on Vercel (Production) and redeploy, or VITE_GEMINI_API_KEY in .env for local dev.',
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
