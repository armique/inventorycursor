import { GoogleGenAI } from '@google/genai';
import { getServerAIKeys } from '../serverAIEnv.js';
import {
  MODEL_PRIORITY,
  runDealSearch,
  runDealSearchRest,
  buildMarketplaceSearchLinks,
  refineQueryWithGroq,
  isRetryableGeminiError,
} from '../dealSearchCore.js';

async function tryGeminiDealSearch(apiKey, criteria) {
  for (const model of MODEL_PRIORITY) {
    try {
      const deals = await runDealSearchRest(apiKey, model, criteria);
      if (deals.length > 0) {
        return { deals, provider: 'gemini-rest', model };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!isRetryableGeminiError(msg)) throw e;
    }
  }

  const ai = new GoogleGenAI({ apiKey });
  for (const model of MODEL_PRIORITY) {
    try {
      const deals = await runDealSearch(ai, model, criteria);
      if (deals.length > 0) {
        return { deals, provider: 'gemini-sdk', model };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!isRetryableGeminiError(msg)) throw e;
    }
  }

  return null;
}

export async function handleDealSearch(req, res) {
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

  const keys = getServerAIKeys();
  let lastError = null;

  if (keys.gemini) {
    try {
      const result = await tryGeminiDealSearch(keys.gemini, criteria);
      if (result) {
        return res.status(200).json({
          deals: result.deals,
          provider: result.provider,
          model: result.model,
          fallback: false,
        });
      }
    } catch (e) {
      lastError = e;
    }
  }

  let refinedQuery = criteria.query;
  if (keys.groq) {
    try {
      refinedQuery = await refineQueryWithGroq(keys.groq, criteria.query);
    } catch {
      /* use original query */
    }
  }

  const linkDeals = buildMarketplaceSearchLinks(criteria, refinedQuery);
  if (linkDeals.length > 0) {
    const noGemini = !keys.gemini;
    const msg = noGemini
      ? 'No Gemini API key on server. Showing direct marketplace search links. Add GEMINI_API_KEY on Vercel and redeploy for live AI results.'
      : keys.groq
        ? 'AI found no listings; Groq refined your query and opened marketplace search pages.'
        : 'AI found no live listings. Open these marketplace searches to browse manually.';
    return res.status(200).json({
      deals: linkDeals,
      provider: keys.groq ? 'groq-links' : 'direct-links',
      fallback: true,
      message: msg,
    });
  }

  const msg =
    lastError instanceof Error
      ? lastError.message
      : !keys.gemini
        ? 'Server missing Gemini API key. Add GEMINI_API_KEY on Vercel (Production) and redeploy.'
        : 'Search failed';

  return res.status(keys.gemini ? 500 : 503).json({
    error:
      msg.includes('429') || msg.includes('exhausted') || msg.includes('quota')
        ? 'AI quota exceeded. Try again later or add GROQ_API_KEY as backup.'
        : msg,
    configuredProviders: Object.entries(keys)
      .filter(([, v]) => v)
      .map(([k]) => k),
  });
}
