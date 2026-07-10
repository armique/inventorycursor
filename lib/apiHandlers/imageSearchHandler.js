/**
 * Real product photo search with a provider fallback chain (same "try the next one" pattern
 * as the spec-parsing AI providers): Google Custom Search → Bing Image Search → Pixabay.
 * All keys are server-side only (Vercel env vars), never exposed to the client.
 *
 * We never scrape Google (or anyone) directly — that's against ToS and actively blocked;
 * every provider here is an official, quota-metered image search API.
 */

function pick(...names) {
  for (const n of names) {
    const v = process.env[n];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/** @typedef {{ url: string; thumbnail: string; title: string; contextLink: string }} ImageResult */

/** Google Custom Search JSON API (image search). Best accuracy for specific product models. */
async function searchGoogle(q, num) {
  const apiKey = pick('GOOGLE_SEARCH_API_KEY', 'VITE_GOOGLE_SEARCH_API_KEY');
  const cx = pick('GOOGLE_SEARCH_CX', 'VITE_GOOGLE_SEARCH_CX');
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

/** Bing Image Search v7 (Azure Cognitive Services / Bing Search APIs). Similar quality to Google. */
async function searchBing(q, num) {
  const apiKey = pick('BING_SEARCH_API_KEY');
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

/** Pixabay — free, no billing account required at all. Mostly stock/generic photos rather than
 * exact product shots, so it's the last-resort fallback rather than the primary provider. */
async function searchPixabay(q, num) {
  const apiKey = pick('PIXABAY_API_KEY');
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

const PROVIDERS = [
  // Google temporarily disabled while its Cloud project / billing config gets sorted out.
  // Re-enable once GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_CX are confirmed working.
  // { name: 'google', run: searchGoogle },
  { name: 'bing', run: searchBing },
  { name: 'pixabay', run: searchPixabay },
];

export async function handleImageSearch(req, res) {
  const q = String(req.query?.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q (search query) is required' });
  const num = Math.max(1, Math.min(10, Number(req.query?.num) || 8));

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
        'No photo search provider configured. Add GOOGLE_SEARCH_API_KEY+GOOGLE_SEARCH_CX, BING_SEARCH_API_KEY, or PIXABAY_API_KEY on Vercel (see API_KEYS_GUIDE.md).',
    });
  }

  // All configured providers ran but none returned results.
  return res.status(200).json({ results: [], lastError: lastError || undefined });
}
