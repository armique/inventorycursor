/**
 * Temporary inbox for the Seller Hub bookmarklet (any logged-in browser).
 * POST from ebay.de (CORS) → GET from the app to merge into IndexedDB + Firebase.
 */
let pending = null;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function bodyOf(req) {
  if (req.body == null) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body || '{}');
    } catch {
      return {};
    }
  }
  return req.body;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (process.env.VERCEL) {
    return res.status(200).json({
      ok: false,
      code: 'local_only',
      hint: 'Bookmarklet auto-send needs the local app (npm run dev). Copy/paste the dump in eBay Tools instead.',
    });
  }

  if (req.method === 'POST') {
    const body = bodyOf(req);
    if (!body || body.kind !== 'inventory-pro-ebay-hub-browser-dump' || !Array.isArray(body.pages)) {
      return res.status(400).json({ ok: false, error: 'Expected a Hub browser dump.' });
    }
    pending = body;
    return res.status(200).json({ ok: true, pages: body.pages.length });
  }

  if (req.method === 'GET') {
    const dump = pending;
    pending = null;
    return res.status(200).json({ ok: true, dump: dump || null });
  }

  res.setHeader('Allow', 'GET, POST, OPTIONS');
  return res.status(405).json({ error: 'Method not allowed' });
}
