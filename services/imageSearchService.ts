/**
 * Real product photo search — calls the server-side /api/images endpoint, which tries a
 * provider chain (Google Custom Search → Bing Image Search → Pixabay, whichever are configured)
 * the same way the spec-parsing AI falls through providers. Only works when deployed on Vercel
 * (or `vercel dev`), same limitation as the other /api/* AI routes in this app; keys stay server-side.
 */

export interface ImageSearchResult {
  url: string;
  thumbnail: string;
  title: string;
  contextLink: string;
}

export async function searchProductPhotos(query: string, count = 8): Promise<ImageSearchResult[]> {
  const q = query.trim();
  if (!q) return [];

  const url = `/api/images?route=search&q=${encodeURIComponent(q)}&num=${count}`;
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
