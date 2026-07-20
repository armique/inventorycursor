/**
 * Lookup product info by EAN/UPC barcode via free public databases.
 * Proxied server-side to avoid browser CORS limits.
 */

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function normalizeBarcode(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 14) return null;
  return digits;
}

async function lookupUpcItemDb(barcode) {
  const url = `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'DeInventory-Pro/1.0' },
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const item = Array.isArray(data?.items) ? data.items[0] : null;
  if (!item) return null;
  const name = String(item.title || item.description || '').trim();
  if (!name) return null;
  return {
    barcode,
    name,
    brand: String(item.brand || item.manufacturer || '').trim() || undefined,
    category: String(item.category || '').trim() || undefined,
    description: String(item.description || '').trim() || undefined,
    imageUrl: Array.isArray(item.images) ? item.images[0] : undefined,
    source: 'upcitemdb',
  };
}

async function lookupOpenProductsFacts(barcode) {
  const url = `https://world.openproductsfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'DeInventory-Pro/1.0' },
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  if (data?.status !== 1 || !data?.product) return null;
  const p = data.product;
  const name = String(
    p.product_name || p.product_name_en || p.generic_name || p.abbreviated_product_name || ''
  ).trim();
  if (!name) return null;
  const brand = String(p.brands || p.brand_owner || '')
    .split(',')[0]
    ?.trim();
  return {
    barcode,
    name: brand ? `${brand} ${name}`.replace(/\s+/g, ' ').trim() : name,
    brand: brand || undefined,
    category: String(p.categories_tags?.[0] || p.categories || '')
      .replace(/^en:/, '')
      .replace(/-/g, ' ')
      .trim() || undefined,
    description: String(p.generic_name || '').trim() || undefined,
    imageUrl: p.image_url || p.image_front_url || undefined,
    source: 'openproductsfacts',
  };
}

async function lookupOpenFoodFacts(barcode) {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'DeInventory-Pro/1.0' },
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  if (data?.status !== 1 || !data?.product) return null;
  const p = data.product;
  const name = String(p.product_name || p.product_name_en || '').trim();
  if (!name) return null;
  const brand = String(p.brands || '')
    .split(',')[0]
    ?.trim();
  return {
    barcode,
    name: brand ? `${brand} ${name}`.replace(/\s+/g, ' ').trim() : name,
    brand: brand || undefined,
    category: 'Food',
    description: String(p.generic_name || '').trim() || undefined,
    imageUrl: p.image_url || p.image_front_url || undefined,
    source: 'openfoodfacts',
  };
}

export async function handleBarcodeLookup(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = typeof req.body === 'object' && req.body ? req.body : {};
  const raw =
    req.query?.barcode ||
    req.query?.upc ||
    req.query?.ean ||
    body.barcode ||
    body.upc ||
    body.ean ||
    '';
  const barcode = normalizeBarcode(raw);
  if (!barcode) {
    return res.status(400).json({
      error: 'Provide a barcode (EAN/UPC) with 8–14 digits.',
    });
  }

  try {
    const results = await Promise.allSettled([
      lookupUpcItemDb(barcode),
      lookupOpenProductsFacts(barcode),
      lookupOpenFoodFacts(barcode),
    ]);
    const hits = results
      .filter((r) => r.status === 'fulfilled' && r.value)
      .map((r) => r.value);

    if (!hits.length) {
      return res.status(404).json({
        error: 'No product found for this barcode in free databases.',
        barcode,
        hint: 'PC parts are often missing — enter the name manually or try Database Search.',
      });
    }

    // Prefer non-food electronics-ish hits when multiple sources respond.
    const preferred =
      hits.find((h) => h.source === 'upcitemdb') ||
      hits.find((h) => h.source === 'openproductsfacts') ||
      hits[0];

    return res.status(200).json({
      ok: true,
      product: preferred,
      alternatives: hits.slice(1),
    });
  } catch (e) {
    return res.status(502).json({
      error: e instanceof Error ? e.message : 'Barcode lookup failed',
      barcode,
    });
  }
}
