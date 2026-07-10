/**
 * Real product photo search via Google Custom Search JSON API (image search).
 * Requires GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_CX (Vercel env vars, server-side only).
 * We never scrape Google directly — that's against their ToS and actively blocked;
 * this uses the official, quota-metered API instead.
 */

function pick(...names) {
  for (const n of names) {
    const v = process.env[n];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function getGoogleSearchConfig() {
  return {
    apiKey: pick('GOOGLE_SEARCH_API_KEY', 'VITE_GOOGLE_SEARCH_API_KEY'),
    cx: pick('GOOGLE_SEARCH_CX', 'VITE_GOOGLE_SEARCH_CX'),
  };
}

export async function handleImageSearch(req, res) {
  const { apiKey, cx } = getGoogleSearchConfig();
  if (!apiKey || !cx) {
    return res.status(500).json({
      error:
        'Server missing Google Custom Search config. Add GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CX on Vercel (see API_KEYS_GUIDE.md).',
    });
  }

  const q = String(req.query?.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q (search query) is required' });

  const num = Math.max(1, Math.min(10, Number(req.query?.num) || 8));

  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('cx', cx);
  url.searchParams.set('q', q);
  url.searchParams.set('searchType', 'image');
  url.searchParams.set('num', String(num));
  url.searchParams.set('safe', 'active');

  try {
    const r = await fetch(url.toString());
    const data = await r.json();
    if (!r.ok) {
      const msg = data?.error?.message || `Google Custom Search API ${r.status}`;
      return res.status(r.status === 429 ? 429 : 502).json({ error: msg });
    }

    const items = Array.isArray(data.items) ? data.items : [];
    const results = items
      .map((it) => ({
        url: it.link,
        thumbnail: it.image?.thumbnailLink || it.link,
        title: it.title || '',
        contextLink: it.image?.contextLink || '',
      }))
      .filter((r) => typeof r.url === 'string' && r.url.trim());

    return res.status(200).json({ results });
  } catch (e) {
    console.error('image-search', e);
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Server error' });
  }
}
