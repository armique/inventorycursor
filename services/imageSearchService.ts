/**
 * Real product photo search — calls the server-side /api/images endpoint, which tries a
 * provider chain (Google Custom Search → Bing → Pixabay → Unsplash → Pexels, whichever are
 * configured) the same way the spec-parsing AI falls through providers — or, if a specific
 * `provider` is passed, uses only that one. Only works when deployed on Vercel (or `vercel dev`),
 * same limitation as the other /api/* AI routes in this app; keys stay server-side.
 */

export interface ImageSearchResult {
  url: string;
  thumbnail: string;
  title: string;
  contextLink: string;
}

export interface ImageSearchProvider {
  name: string;
  label: string;
  configured: boolean;
}

export async function getImageSearchProviders(): Promise<ImageSearchProvider[]> {
  try {
    const res = await fetch('/api/images?route=providers');
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.providers) ? data.providers : [];
  } catch {
    return [];
  }
}

export async function searchProductPhotos(
  query: string,
  count = 8,
  provider?: string
): Promise<ImageSearchResult[]> {
  const q = query.trim();
  if (!q) return [];

  let url = `/api/images?route=search&q=${encodeURIComponent(q)}&num=${count}`;
  if (provider) url += `&provider=${encodeURIComponent(provider)}`;

  const res = await fetch(url);
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // fall through to generic error below
  }
  if (!res.ok) {
    throw new Error(data?.error || `Photo search failed (HTTP ${res.status}).`);
  }
  const results = Array.isArray(data?.results) ? data.results : [];
  if (results.length === 0 && data?.lastError) {
    throw new Error(data.lastError);
  }
  return results;
}
