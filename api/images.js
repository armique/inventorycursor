/**
 * Image search API (product photo lookup for the item editor).
 */
import { handleImageSearch, handleImageSearchProviders } from '../lib/apiHandlers/imageSearchHandler.js';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const route = String(req.query?.route || '').trim();
  switch (route) {
    case 'search':
      return handleImageSearch(req, res);
    case 'providers':
      return handleImageSearchProviders(req, res);
    default:
      return res.status(400).json({ error: 'Unknown route. Use ?route=search or ?route=providers' });
  }
}
