/**
 * Kleinanzeigen listing photo fetch (public profile + single ad pages).
 */

export interface KaMyListing {
  listingId: string;
  title: string;
  listingUrl: string;
  thumbnail?: string;
  imageUrls: string[];
  price?: number;
}

function apiErrorHint(status: number, data: { error?: unknown }): string | undefined {
  if (status === 404) {
    return 'Kleinanzeigen listings API not available. Restart `npm run dev` (local) or deploy the latest build (Vercel).';
  }
  return typeof data.error === 'string' ? data.error : undefined;
}

export function extractKaListingId(input: string): string | null {
  const raw = String(input || '').trim();
  if (!raw) return null;
  if (/^\d{6,16}$/.test(raw)) return raw;

  const fromPath =
    raw.match(/s-anzeige\/(?:[^/?#]+\/)?(\d{6,16})(?:-\d+-\d+)?/i)?.[1] ||
    raw.match(/\/(\d{8,16})-\d{1,4}-\d{1,6}(?:[/?#]|$)/)?.[1];
  if (fromPath) return fromPath;

  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, '');
    if (host !== 'kleinanzeigen.de') return null;
    return (
      url.pathname.match(/s-anzeige\/(?:[^/]+\/)?(\d{6,16})/i)?.[1] ||
      url.pathname.match(/\/(\d{8,16})-\d{1,4}-\d{1,6}(?:\/|$)/)?.[1] ||
      null
    );
  } catch {
    return null;
  }
}

export function isKaListingUrl(input: string): boolean {
  const raw = String(input || '').trim();
  if (!raw) return false;
  if (/^\d{6,16}$/.test(raw)) return true;
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, '');
    return host === 'kleinanzeigen.de' && /\/s-anzeige\//i.test(url.pathname);
  } catch {
    return /kleinanzeigen\.de\/s-anzeige\//i.test(raw);
  }
}

export function toKaListingUrl(input: string): string | null {
  const raw = String(input || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'kleinanzeigen.de' && /\/s-anzeige\//i.test(url.pathname)) {
      url.hash = '';
      return url.toString();
    }
  } catch {
    // fall through to id
  }
  const id = extractKaListingId(raw);
  return id ? `https://www.kleinanzeigen.de/s-anzeige/${id}` : null;
}

function normalizeKaListing(raw: Partial<KaMyListing> | null | undefined): KaMyListing | null {
  if (!raw) return null;
  const listingId = String(raw.listingId || extractKaListingId(raw.listingUrl || '') || '').trim();
  const title = String(raw.title || '').replace(/\s+/g, ' ').trim();
  if (!listingId || !title) return null;
  const imageUrls = Array.isArray(raw.imageUrls)
    ? raw.imageUrls.filter((u): u is string => typeof u === 'string' && u.trim().length > 0).map((u) => u.trim())
    : [];
  const listingUrl =
    String(raw.listingUrl || '').trim() || `https://www.kleinanzeigen.de/s-anzeige/${listingId}`;
  const thumbnail = String(raw.thumbnail || imageUrls[0] || '').trim() || undefined;
  const price = typeof raw.price === 'number' && Number.isFinite(raw.price) && raw.price > 0 ? raw.price : undefined;
  return { listingId, title, listingUrl, thumbnail, imageUrls, price };
}

async function fetchKaListingsApi(url: string): Promise<{
  listings: KaMyListing[];
  listing: KaMyListing | null;
}> {
  const res = await fetch(`/api/kleinanzeigen-listings?url=${encodeURIComponent(url)}`);
  const data = (await res.json().catch(() => ({}))) as {
    error?: unknown;
    listings?: unknown[];
    listing?: Partial<KaMyListing>;
  };
  if (!res.ok) {
    throw new Error(apiErrorHint(res.status, data) || `Failed to fetch Kleinanzeigen listing: ${res.status}`);
  }
  const listings = (Array.isArray(data.listings) ? data.listings : [])
    .map((row) => normalizeKaListing(row as Partial<KaMyListing>))
    .filter((row): row is KaMyListing => Boolean(row));
  const listing = normalizeKaListing(data.listing) || listings[0] || null;
  return { listings, listing };
}

export async function fetchKaListingsFromProfile(profileUrl: string): Promise<KaMyListing[]> {
  const url = String(profileUrl || '').trim();
  if (!url) return [];
  const { listings } = await fetchKaListingsApi(url);
  return listings;
}

export async function fetchKaListingByUrl(adUrlOrId: string): Promise<KaMyListing | null> {
  const url = toKaListingUrl(adUrlOrId);
  if (!url) return null;
  const { listing } = await fetchKaListingsApi(url);
  return listing;
}

export async function hydrateKaListingPhotos(listing: KaMyListing): Promise<KaMyListing> {
  if (listing.imageUrls.length > 1) return listing;
  if (!listing.listingUrl && !listing.listingId) return listing;
  try {
    const full = await fetchKaListingByUrl(listing.listingUrl || listing.listingId);
    if (!full?.imageUrls?.length) return listing;
    return {
      ...listing,
      ...full,
      title: listing.title || full.title,
      price: listing.price ?? full.price,
      thumbnail: full.thumbnail || listing.thumbnail,
      imageUrls: full.imageUrls,
    };
  } catch {
    return listing;
  }
}

export async function hydrateKaListingsPhotos(
  listings: KaMyListing[],
  concurrency = 3
): Promise<KaMyListing[]> {
  if (!listings.length) return listings;
  const out: KaMyListing[] = new Array(listings.length);
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, concurrency), listings.length);
  async function worker() {
    while (cursor < listings.length) {
      const idx = cursor;
      cursor += 1;
      out[idx] = await hydrateKaListingPhotos(listings[idx]);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return out;
}
