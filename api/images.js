/**
 * Image search API (product photo lookup for the item editor).
 * POST routes: enhance (product photo cleanup), product-card (Gemini premium card)
 */
import { handleImageFetch } from '../lib/apiHandlers/imageFetchHandler.js';
import { handleImageSearch, handleImageSearchProviders } from '../lib/apiHandlers/imageSearchHandler.js';
import {
  handleEnhanceProviders,
  handleProductPhotoEnhance,
} from '../lib/apiHandlers/productPhotoEnhanceHandler.js';
import { handleProductCardGemini } from '../lib/apiHandlers/productCardGeminiHandler.js';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const route = String(req.query?.route || '').trim();

  if (route === 'enhance' && req.method === 'POST') {
    return handleProductPhotoEnhance(req, res);
  }
  if (route === 'enhance-providers') {
    return handleEnhanceProviders(req, res);
  }
  if (route === 'product-card' && req.method === 'POST') {
    return handleProductCardGemini(req, res);
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  switch (route) {
    case 'search':
      return handleImageSearch(req, res);
    case 'providers':
      return handleImageSearchProviders(req, res);
    case 'fetch':
      return handleImageFetch(req, res);
    default:
      return res.status(400).json({
        error: 'Unknown route. Use ?route=search, providers, fetch, enhance, enhance-providers, product-card',
      });
  }
}
