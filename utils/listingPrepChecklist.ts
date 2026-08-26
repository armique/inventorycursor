/**
 * Listing prep checklist — title + description + photos before saleReady / List Ready.
 */
import type { InventoryItem } from '../types';
import { ItemStatus } from '../types';
import { getItemUserPhotoUrls, itemHasUserPhotos } from './imageImport';

export type ListingPrepKey = 'title' | 'description' | 'photos';

export type ListingPrepChecklist = {
  hasTitle: boolean;
  hasDescription: boolean;
  hasPhotos: boolean;
  photoCount: number;
  titlePreview: string;
  descriptionChars: number;
  complete: boolean;
  missing: ListingPrepKey[];
};

const MIN_TITLE_LEN = 8;
const MIN_DESCRIPTION_LEN = 40;
/** At least one real user photo (card or lot shot). */
const MIN_PHOTOS = 1;

export function resolveListingTitle(item: InventoryItem): string {
  return String(item.marketTitle || '').trim();
}

export function resolveListingDescription(item: InventoryItem): string {
  return String(item.marketDescription || '').trim();
}

export function getListingPrepChecklist(item: InventoryItem): ListingPrepChecklist {
  const title = resolveListingTitle(item);
  const description = resolveListingDescription(item);
  const photos = getItemUserPhotoUrls(item);
  const hasTitle = title.length >= MIN_TITLE_LEN;
  const hasDescription = description.length >= MIN_DESCRIPTION_LEN;
  const hasPhotos = photos.length >= MIN_PHOTOS && itemHasUserPhotos(item);
  const missing: ListingPrepKey[] = [];
  if (!hasTitle) missing.push('title');
  if (!hasDescription) missing.push('description');
  if (!hasPhotos) missing.push('photos');
  return {
    hasTitle,
    hasDescription,
    hasPhotos,
    photoCount: photos.length,
    titlePreview: title.slice(0, 80),
    descriptionChars: description.length,
    complete: missing.length === 0,
    missing,
  };
}

export function isListingPrepEligible(item: InventoryItem): boolean {
  // Defective/for-parts items ARE listable (as "For parts or not working") — they're
  // gated separately in ebayListingReadiness.ts, which requires a fault note before
  // that condition is allowed to publish. This checklist only covers title/description/photos.
  return (
    (item.status === ItemStatus.IN_STOCK || item.status === ItemStatus.ORDERED) &&
    !item.isDraft &&
    !item.parentContainerId
  );
}

/** Can toggle saleReady / appear in List Ready queue. */
export function canMarkSaleReady(item: InventoryItem): boolean {
  return isListingPrepEligible(item) && getListingPrepChecklist(item).complete;
}

export function listingPrepMissingLabel(missing: ListingPrepKey[]): string {
  const map: Record<ListingPrepKey, string> = {
    title: 'title',
    description: 'description',
    photos: 'photos',
  };
  return missing.map((m) => map[m]).join(' · ');
}

/**
 * Trigger browser downloads for each listing photo (Claude / you can pick from Downloads).
 * Firebase/https URLs work with <a download>; cross-origin may open in tab — still usable.
 */
export async function downloadListingPhotosToComputer(
  item: InventoryItem,
  opts?: { max?: number },
): Promise<{ ok: number; failed: number }> {
  const urls = getItemUserPhotoUrls(item).slice(0, opts?.max ?? 12);
  const safe = (item.name || item.id || 'item')
    .replace(/[^\w\-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 40);
  let ok = 0;
  let failed = 0;
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const ext =
        blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `${safe}_${i + 1}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      ok += 1;
      await new Promise((r) => setTimeout(r, 180));
    } catch {
      // Fallback: open URL (user can Save As)
      try {
        window.open(url, '_blank', 'noopener,noreferrer');
        ok += 1;
      } catch {
        failed += 1;
      }
    }
  }
  return { ok, failed };
}
