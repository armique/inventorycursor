/**
 * Real product photo search across multiple providers. By default tries them in order (same
 * "try the next one" pattern as the spec-parsing AI providers) until one returns results; the
 * client can also force a single specific provider via `?provider=`.
 * All keys are server-side only (Vercel env vars), never exposed to the client.
 *
 * We never scrape anyone directly — that's against ToS and actively blocked; every provider
 * here is an official, quota-metered image search API.
 */

function pick(...names) {
  for (const n of names) {
    const v = process.env[n];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/** @typedef {{ url: string; thumbnail: string; title: string; contextLink: string }} ImageResult */

/** Google Custom Search JSON API (image search). Best accuracy for exact product/model matches. */
function googleConfig() {
  return {
    apiKey: pick('GOOGLE_SEARCH_API_KEY', 'VITE_GOOGLE_SEARCH_API_KEY'),
    cx: pick('GOOGLE_SEARCH_CX', 'VITE_GOOGLE_SEARCH_CX'),
  };
}
async function searchGoogle(q, num) {
  const { apiKey, cx } = googleConfig();
  if (!apiKey || !cx) return null; // not configured — skip, not an error

  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('cx', cx);
  url.searchParams.set('q', q);
  url.searchParams.set('searchType', 'image');
  url.searchParams.set('num', String(num));
  url.searchParams.set('safe', 'active');

  const r = await fetch(url.toString());
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `Google Custom Search API ${r.status}`);

  const items = Array.isArray(data.items) ? data.items : [];
  return items
    .map((it) => ({
      url: it.link,
      thumbnail: it.image?.thumbnailLink || it.link,
      title: it.title || '',
      contextLink: it.image?.contextLink || '',
    }))
    .filter((r) => typeof r.url === 'string' && r.url.trim());
}

/** Bing Image Search v7 (Azure Cognitive Services). Also indexes real retailer/tech listing
 * pages, so it matches exact product models much better than a stock-photo library. */
function bingConfig() {
  return { apiKey: pick('BING_SEARCH_API_KEY') };
}
async function searchBing(q, num) {
  const { apiKey } = bingConfig();
  if (!apiKey) return null;

  const url = new URL('https://api.bing.microsoft.com/v7.0/images/search');
  url.searchParams.set('q', q);
  url.searchParams.set('count', String(num));
  url.searchParams.set('safeSearch', 'Moderate');

  const r = await fetch(url.toString(), {
    headers: { 'Ocp-Apim-Subscription-Key': apiKey },
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `Bing Image Search API ${r.status}`);

  const items = Array.isArray(data.value) ? data.value : [];
  return items
    .map((it) => ({
      url: it.contentUrl,
      thumbnail: it.thumbnailUrl || it.contentUrl,
      title: it.name || '',
      contextLink: it.hostPageUrl || '',
    }))
    .filter((r) => typeof r.url === 'string' && r.url.trim());
}

/** Pixabay — free, no billing account needed. Stock-photo library matched by tags, not exact
 * model numbers, so it can return a similar-but-wrong product (e.g. a different CPU generation). */
function pixabayConfig() {
  return { apiKey: pick('PIXABAY_API_KEY') };
}
async function searchPixabay(q, num) {
  const { apiKey } = pixabayConfig();
  if (!apiKey) return null;

  const url = new URL('https://pixabay.com/api/');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('q', q);
  url.searchParams.set('image_type', 'photo');
  url.searchParams.set('safesearch', 'true');
  url.searchParams.set('per_page', String(Math.max(3, num))); // Pixabay requires per_page >= 3

  const r = await fetch(url.toString());
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error || `Pixabay API ${r.status}`);

  const items = Array.isArray(data.hits) ? data.hits : [];
  return items
    .slice(0, num)
    .map((it) => ({
      url: it.largeImageURL || it.webformatURL,
      thumbnail: it.previewURL || it.webformatURL,
      title: it.tags || '',
      contextLink: it.pageURL || '',
    }))
    .filter((r) => typeof r.url === 'string' && r.url.trim());
}

/** Unsplash — free, no billing needed. Also a general stock-photo library (same caveat as Pixabay). */
function unsplashConfig() {
  return { apiKey: pick('UNSPLASH_ACCESS_KEY') };
}
async function searchUnsplash(q, num) {
  const { apiKey } = unsplashConfig();
  if (!apiKey) return null;

  const url = new URL('https://api.unsplash.com/search/photos');
  url.searchParams.set('query', q);
  url.searchParams.set('per_page', String(num));

  const r = await fetch(url.toString(), {
    headers: { Authorization: `Client-ID ${apiKey}` },
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.errors?.[0] || `Unsplash API ${r.status}`);

  const items = Array.isArray(data.results) ? data.results : [];
  return items
    .map((it) => ({
      url: it.urls?.regular || it.urls?.full,
      thumbnail: it.urls?.thumb || it.urls?.small,
      title: it.alt_description || it.description || '',
      contextLink: it.links?.html || '',
    }))
    .filter((r) => typeof r.url === 'string' && r.url.trim());
}

/** Pexels — free, no billing needed. Same general stock-photo caveat as Pixabay/Unsplash. */
function pexelsConfig() {
  return { apiKey: pick('PEXELS_API_KEY') };
}
async function searchPexels(q, num) {
  const { apiKey } = pexelsConfig();
  if (!apiKey) return null;

  const url = new URL('https://api.pexels.com/v1/search');
  url.searchParams.set('query', q);
  url.searchParams.set('per_page', String(num));

  const r = await fetch(url.toString(), { headers: { Authorization: apiKey } });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error || `Pexels API ${r.status}`);

  const items = Array.isArray(data.photos) ? data.photos : [];
  return items
    .map((it) => ({
      url: it.src?.large || it.src?.original,
      thumbnail: it.src?.medium || it.src?.small,
      title: it.alt || '',
      contextLink: it.url || '',
    }))
    .filter((r) => typeof r.url === 'string' && r.url.trim());
}

/** eBay Browse API — searches real eBay listings by keyword and returns their photos. Since this
 * app's items are often named to match real eBay listing titles, this tends to match exact
 * models much better than a general stock-photo library. Uses the OAuth2 client-credentials
 * grant (app-level, no user login) — a fresh token is fetched per search for simplicity. */
function ebayConfig() {
  return {
    clientId: pick('EBAY_CLIENT_ID'),
    clientSecret: pick('EBAY_CLIENT_SECRET'),
    marketplace: pick('EBAY_MARKETPLACE_ID') || 'EBAY_DE',
  };
}
async function getEbayAccessToken(clientId, clientSecret) {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const r = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error_description || `eBay OAuth token request failed (${r.status})`);
  return data.access_token;
}
async function searchEbay(q, num) {
  const { clientId, clientSecret, marketplace } = ebayConfig();
  if (!clientId || !clientSecret) return null;

  const token = await getEbayAccessToken(clientId, clientSecret);

  const url = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
  url.searchParams.set('q', q);
  url.searchParams.set('limit', String(num));

  const r = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': marketplace,
    },
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.errors?.[0]?.message || `eBay Browse API ${r.status}`);

  const items = Array.isArray(data.itemSummaries) ? data.itemSummaries : [];
  return items
    .map((it) => ({
      url: it.image?.imageUrl,
      thumbnail: it.image?.imageUrl,
      title: it.title || '',
      contextLink: it.itemWebUrl || '',
    }))
    .filter((r) => typeof r.url === 'string' && r.url.trim());
}

const PROVIDERS = [
  { name: 'google', label: 'Google', run: searchGoogle, isConfigured: () => { const c = googleConfig(); return !!(c.apiKey && c.cx); } },
  { name: 'bing', label: 'Bing', run: searchBing, isConfigured: () => !!bingConfig().apiKey },
  { name: 'ebay', label: 'eBay', run: searchEbay, isConfigured: () => { const c = ebayConfig(); return !!(c.clientId && c.clientSecret); } },
  { name: 'pixabay', label: 'Pixabay', run: searchPixabay, isConfigured: () => !!pixabayConfig().apiKey },
  { name: 'unsplash', label: 'Unsplash', run: searchUnsplash, isConfigured: () => !!unsplashConfig().apiKey },
  { name: 'pexels', label: 'Pexels', run: searchPexels, isConfigured: () => !!pexelsConfig().apiKey },
];

/** Lists which providers are configured, so the client can offer a picker without exposing keys. */
export async function handleImageSearchProviders(_req, res) {
  const providers = PROVIDERS.map((p) => ({ name: p.name, label: p.label, configured: p.isConfigured() }));
  return res.status(200).json({ providers });
}

export async function handleImageSearch(req, res) {
  const q = String(req.query?.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q (search query) is required' });
  const num = Math.max(1, Math.min(10, Number(req.query?.num) || 8));
  const forcedProvider = String(req.query?.provider || '').trim();

  if (forcedProvider) {
    const provider = PROVIDERS.find((p) => p.name === forcedProvider);
    if (!provider) return res.status(400).json({ error: `Unknown provider "${forcedProvider}".` });
    if (!provider.isConfigured()) {
      return res.status(500).json({ error: `${provider.label} is not configured (missing API key on Vercel).` });
    }
    try {
      const results = (await provider.run(q, num)) || [];
      return res.status(200).json({ results, provider: provider.name });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`image-search [${provider.name}] failed:`, msg);
      return res.status(502).json({ error: msg });
    }
  }

  // No specific provider requested: try each configured one in order until one returns results.
  let anyConfigured = false;
  let lastError = '';

  for (const provider of PROVIDERS) {
    try {
      const results = await provider.run(q, num);
      if (results === null) continue; // not configured, try next
      anyConfigured = true;
      if (results.length > 0) {
        return res.status(200).json({ results, provider: provider.name });
      }
      // configured but zero results — try the next provider before giving up
    } catch (e) {
      anyConfigured = true;
      lastError = e instanceof Error ? e.message : String(e);
      console.warn(`image-search [${provider.name}] failed:`, lastError);
    }
  }

  if (!anyConfigured) {
    return res.status(500).json({
      error:
        'No photo search provider configured. Add at least one of GOOGLE_SEARCH_API_KEY+GOOGLE_SEARCH_CX, BING_SEARCH_API_KEY, PIXABAY_API_KEY, UNSPLASH_ACCESS_KEY, or PEXELS_API_KEY on Vercel (see API_KEYS_GUIDE.md).',
    });
  }

  // All configured providers ran but none returned results.
  return res.status(200).json({ results: [], lastError: lastError || undefined });
}
