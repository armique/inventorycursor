import { CLOUD_OMITTED_PLACEHOLDER } from './firebaseService';

/** URLs safe to put in <img src> on the public storefront (avoids broken icons). */
export function isUsableProductImageUrl(url: string | undefined | null): boolean {
  const s = typeof url === 'string' ? url.trim() : '';
  if (!s) return false;
  if (s === CLOUD_OMITTED_PLACEHOLDER) return false;
  if (s.startsWith('data:image/')) return true;
  if (s.startsWith('https://') || s.startsWith('http://')) return true;
  return false;
}

export function filterUsableImageUrls(urls: (string | undefined | null)[] | undefined): string[] {
  if (!urls?.length) return [];
  const out: string[] = [];
  for (const u of urls) {
    if (isUsableProductImageUrl(u) && !out.includes(u!)) out.push(u!.trim());
  }
  return out;
}
