/**
 * Real product photo search — calls the server-side /api/images endpoint (Google Custom
 * Search JSON API for images). Only works when deployed on Vercel (or `vercel dev`), same
 * limitation as the other /api/* AI routes in this app; the API key stays server-side.
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
  return Array.isArray(data?.results) ? data.results : [];
}
