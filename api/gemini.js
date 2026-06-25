/**
 * Unified Gemini API (deal search + screenshot parsers).
 * Legacy paths rewritten in vercel.json → ?route=...
 */
import { handleDealSearch } from '../lib/apiHandlers/dealSearchHandler.js';
import { handleEbayScreenshot } from '../lib/apiHandlers/ebayScreenshotHandler.js';
import { handleKaScreenshot } from '../lib/apiHandlers/kaScreenshotHandler.js';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let route = String(req.query?.route || '').trim();
  if (!route && req.url) {
    const path = String(req.url).split('?')[0] || '';
    if (path.includes('deal-search')) route = 'deal-search';
    else if (path.includes('ebay-screenshot') || path.includes('parse-ebay-order'))
      route = 'ebay-screenshot';
    else if (path.includes('ka-screenshot') || path.includes('kleinanzeigen-chat'))
      route = 'ka-screenshot';
  }

  switch (route) {
    case 'deal-search':
      return handleDealSearch(req, res);
    case 'ebay-screenshot':
      return handleEbayScreenshot(req, res);
    case 'ka-screenshot':
      return handleKaScreenshot(req, res);
    default:
      return res.status(400).json({
        error: 'Unknown route. Use ?route=deal-search|ebay-screenshot|ka-screenshot',
      });
  }
}
