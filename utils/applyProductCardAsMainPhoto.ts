/**
 * Safely set an AI product card as an inventory item's main photo.
 * Avoids re-encoding durable Storage URLs and never puts multi‑MB data URLs
 * into inventory state (that was crashing sync / localStorage).
 */

import type { GeneratedProductCardEntry, InventoryItem } from '../types';
import { isDurableFirebaseStorageUrl } from '../services/inventoryImageStorage';
import {
  isProductCardIdbUrl,
  resolveProductCardImageUrl,
} from '../services/productCardGallery';
import { normalizeImageList, prepareInventoryImagesForStorage } from './imageImport';

export async function resolveUrlForInventoryMainPhoto(
  source: string,
  itemId: string,
  galleryEntry?: GeneratedProductCardEntry | null
): Promise<string> {
  let url = (source || '').trim();

  // Prefer durable cloud URL from the saved gallery entry
  if (galleryEntry?.cloudStored && galleryEntry.imageUrl?.startsWith('http')) {
    url = galleryEntry.imageUrl;
  } else if (galleryEntry && (isProductCardIdbUrl(galleryEntry.imageUrl) || !url)) {
    try {
      url = await resolveProductCardImageUrl(galleryEntry);
    } catch {
      /* keep source */
    }
  }

  if (!url) throw new Error('No image to apply');

  // Already on Firebase Storage — use as-is (no re-download / re-compress)
  if (isDurableFirebaseStorageUrl(url)) {
    return url;
  }

  // idb: / data: → persist into items/{uid}/{itemId}/ as compressed JPEG
  try {
    const prepared = await prepareInventoryImagesForStorage([url], { itemId });
    const out = prepared[0] || url;
    if (out.startsWith('data:') && out.length > 450_000) {
      throw new Error(
        'Image is too large to store locally. Sign in with Google so cards save to cloud Storage, then try again.'
      );
    }
    return out;
  } catch (err) {
    if (isDurableFirebaseStorageUrl(url)) return url;
    throw err instanceof Error ? err : new Error('Could not prepare card photo');
  }
}

export function mergeMainPhotoOntoItem(item: InventoryItem, photoUrl: string): InventoryItem {
  const merged = normalizeImageList([photoUrl, item.imageUrl, ...(item.imageUrls || [])]);
  return {
    ...item,
    imageUrl: merged[0] || photoUrl,
    imageUrls: merged,
  };
}

/** Append a photo to the item gallery without changing the current main (unless empty). */
export function mergePhotoOntoItemGallery(item: InventoryItem, photoUrl: string): InventoryItem {
  const merged = normalizeImageList([item.imageUrl, ...(item.imageUrls || []), photoUrl]);
  return {
    ...item,
    imageUrl: merged[0] || photoUrl,
    imageUrls: merged,
  };
}
