/**
 * Persist inventory photos to Firebase Storage (durable copies) or compressed local data URLs.
 * Remote URLs (eBay, search, Imgur) are downloaded, compressed, and uploaded so listings can
 * disappear without breaking your inventory photos.
 */

import { CATEGORY_IMAGES } from './hardwareDB';
import {
  compressBlobToJpeg,
  compressBlobToLocalDataUrl,
  compressDataUrlToBlob,
  compressImageFileToBlob,
  dataUrlFromBlob,
  INVENTORY_PHOTO_LOCAL_OPTIONS,
  INVENTORY_PHOTO_STORAGE_OPTIONS,
} from '../utils/imageCompress';
import { CLOUD_OMITTED_PLACEHOLDER, getCurrentUser, isCloudEnabled, uploadItemImageBlob } from './firebaseService';
import type { InventoryItem } from '../types';

const CATEGORY_PLACEHOLDER_IMAGES = new Set(Object.values(CATEGORY_IMAGES));

function isCategoryPlaceholderImage(url: string): boolean {
  return CATEGORY_PLACEHOLDER_IMAGES.has(url.trim());
}

export interface PersistInventoryImagesOptions {
  /** Inventory item id — photos land in items/{uid}/{itemId}/. Use "shared" for bulk imports. */
  itemId?: string;
  onProgress?: (done: number, total: number) => void;
}

/** Session cache: source URL → persisted Storage URL (avoids re-uploading the same eBay photo). */
const sourceUrlCache = new Map<string, string>();

/** In-flight dedupe for concurrent imports of the same source URL. */
const inFlightBySource = new Map<string, Promise<string>>();

export function isFirebaseStorageInventoryUrl(url: string): boolean {
  const s = url.trim();
  if (!s) return false;
  if (!s.startsWith('https://')) return false;
  if (!s.includes('firebasestorage.googleapis.com') && !s.includes('firebasestorage.app')) return false;
  return s.includes('/items%2F') || s.includes('/items/');
}

function isRemoteHttpUrl(url: string): boolean {
  const s = url.trim();
  return s.startsWith('https://') || s.startsWith('http://');
}

function isDataImageUrl(url: string): boolean {
  return url.trim().startsWith('data:image/');
}

function canUploadToCloud(): boolean {
  return isCloudEnabled() && Boolean(getCurrentUser());
}

export function canArchivePhotosToCloud(): boolean {
  return canUploadToCloud();
}

export function urlNeedsPhotoArchive(url: string | undefined | null): boolean {
  const s = typeof url === 'string' ? url.trim() : '';
  if (!s) return false;
  if (s === CLOUD_OMITTED_PLACEHOLDER) return false;
  if (isCategoryPlaceholderImage(s)) return false;
  if (isFirebaseStorageInventoryUrl(s)) return false;
  return isRemoteHttpUrl(s) || isDataImageUrl(s);
}

function collectPhotoUrlsFromItem(item: InventoryItem): string[] {
  return [item.imageUrl, ...(item.imageUrls || []), ...(item.storeGalleryUrls || [])].filter(
    (u): u is string => typeof u === 'string' && u.trim().length > 0
  );
}

export interface PhotoArchiveAnalysis {
  /** Items that have at least one photo needing archive. */
  itemsAffected: number;
  /** Unique remote/local photos across inventory (+ trash if scanned). */
  uniquePhotosToArchive: number;
  /** Photo slots already on Firebase Storage. */
  alreadyArchivedSlots: number;
}

export function analyzeInventoryPhotoArchive(
  items: InventoryItem[],
  trash: InventoryItem[] = []
): PhotoArchiveAnalysis {
  const all = [...items, ...trash];
  const unique = new Set<string>();
  let itemsAffected = 0;
  let alreadyArchivedSlots = 0;

  for (const item of all) {
    const urls = collectPhotoUrlsFromItem(item);
    let itemNeeds = false;
    for (const url of urls) {
      if (urlNeedsPhotoArchive(url)) {
        unique.add(url);
        itemNeeds = true;
      } else if (isFirebaseStorageInventoryUrl(url)) {
        alreadyArchivedSlots++;
      }
    }
    if (itemNeeds) itemsAffected++;
  }

  return {
    itemsAffected,
    uniquePhotosToArchive: unique.size,
    alreadyArchivedSlots,
  };
}

export interface PhotoArchiveProgress {
  done: number;
  total: number;
  currentUrl?: string;
}

export interface PhotoArchiveResult {
  uniquePhotosToArchive: number;
  photosArchived: number;
  photosFailed: number;
  itemsUpdated: number;
  failures?: PhotoArchiveFailure[];
}

export interface PhotoArchiveFailure {
  url: string;
  error: string;
  items: { id: string; name: string; inTrash: boolean }[];
}

export interface UnarchivedPhotoEntry {
  url: string;
  items: { id: string; name: string; inTrash: boolean }[];
}

/** Items still using remote/data URLs — use this to find photos that failed archive. */
export function listUnarchivedPhotoEntries(
  items: InventoryItem[],
  trash: InventoryItem[] = []
): UnarchivedPhotoEntry[] {
  const byUrl = new Map<string, UnarchivedPhotoEntry>();

  const scan = (item: InventoryItem, inTrash: boolean) => {
    for (const url of collectPhotoUrlsFromItem(item)) {
      if (!urlNeedsPhotoArchive(url)) continue;
      const existing = byUrl.get(url);
      const row = { id: item.id, name: item.name || item.id, inTrash };
      if (existing) {
        if (!existing.items.some((x) => x.id === row.id)) existing.items.push(row);
      } else {
        byUrl.set(url, { url, items: [row] });
      }
    }
  };

  items.forEach((item) => scan(item, false));
  trash.forEach((item) => scan(item, true));
  return [...byUrl.values()].sort((a, b) => a.items[0]?.name.localeCompare(b.items[0]?.name || '') || 0);
}

function itemsUsingPhotoUrl(items: InventoryItem[], trash: InventoryItem[], url: string) {
  const all = [
    ...items.map((i) => ({ item: i, inTrash: false })),
    ...trash.map((i) => ({ item: i, inTrash: true })),
  ];
  const out: { id: string; name: string; inTrash: boolean }[] = [];
  for (const { item, inTrash } of all) {
    if (collectPhotoUrlsFromItem(item).includes(url)) {
      out.push({ id: item.id, name: item.name || item.id, inTrash });
    }
  }
  return out;
}

function remotePhotoFetchVariants(url: string): string[] {
  const trimmed = url.trim();
  const out = [trimmed];
  try {
    const u = new URL(trimmed);
    const host = u.hostname.toLowerCase();
    if (host.includes('ebayimg.com')) {
      const l1600 = trimmed.replace(/\/s-l\d+\.(jpg|jpeg|png|webp)(\?.*)?$/i, '/s-l1600.$1$2');
      if (l1600 !== trimmed) out.push(l1600);
      const dollar57 = trimmed.replace(/\$_\d+\.(JPG|JPEG|PNG|jpg|jpeg|png)/g, '$_57.$1');
      if (dollar57 !== trimmed) out.push(dollar57);
      const noQuery = trimmed.split('?')[0];
      if (noQuery !== trimmed) out.push(noQuery);
    }
  } catch {
    /* ignore */
  }
  return [...new Set(out)];
}

/** Clear cached failure so a retry can re-download. */
export function clearPhotoArchiveCacheForUrl(url: string): void {
  sourceUrlCache.delete(url.trim());
}

export async function probePhotoArchiveUrl(url: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await fetchRemoteImageBlob(url);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || 'Download failed' };
  }
}

function remapItemPhotoUrls(item: InventoryItem, urlMap: Map<string, string>): InventoryItem {
  const mapUrl = (u?: string) => {
    if (!u) return u;
    return urlMap.get(u) ?? u;
  };
  return {
    ...item,
    imageUrl: mapUrl(item.imageUrl),
    imageUrls: item.imageUrls?.map((u) => mapUrl(u) || u),
    storeGalleryUrls: item.storeGalleryUrls?.map((u) => mapUrl(u) || u),
  };
}

/** Bulk-download remote photos and upload to Firebase Storage; updates item URLs in place. */
export async function bulkArchiveInventoryPhotos(
  items: InventoryItem[],
  options?: {
    trash?: InventoryItem[];
    onProgress?: (progress: PhotoArchiveProgress) => void;
  }
): Promise<{
  items: InventoryItem[];
  trash: InventoryItem[];
  result: PhotoArchiveResult;
}> {
  if (!canUploadToCloud()) {
    throw new Error('Sign in with Google and configure Firebase to archive photos to Storage.');
  }

  const trash = options?.trash ?? [];
  const allItems = [...items, ...trash];
  const uniqueToArchive = new Set<string>();

  for (const item of allItems) {
    for (const url of collectPhotoUrlsFromItem(item)) {
      if (urlNeedsPhotoArchive(url)) uniqueToArchive.add(url);
    }
  }

  const urlList = [...uniqueToArchive];
  const urlMap = new Map<string, string>();
  let photosArchived = 0;
  let photosFailed = 0;
  const failures: PhotoArchiveFailure[] = [];

  for (let i = 0; i < urlList.length; i++) {
    const source = urlList[i];
    options?.onProgress?.({ done: i, total: urlList.length, currentUrl: source });
    clearPhotoArchiveCacheForUrl(source);
    try {
      const persisted = await persistOneInventoryImageUrl(source, 'shared', { force: true });
      urlMap.set(source, persisted);
      if (isFirebaseStorageInventoryUrl(persisted) && persisted !== source) {
        photosArchived++;
      } else {
        photosFailed++;
        const probe = await probePhotoArchiveUrl(source);
        failures.push({
          url: source,
          error: probe.error || 'Still using original URL after archive attempt',
          items: itemsUsingPhotoUrl(items, trash, source),
        });
      }
    } catch (e) {
      photosFailed++;
      urlMap.set(source, source);
      failures.push({
        url: source,
        error: (e as Error)?.message || 'Archive failed',
        items: itemsUsingPhotoUrl(items, trash, source),
      });
    }
  }

  options?.onProgress?.({ done: urlList.length, total: urlList.length });

  let itemsUpdated = 0;
  const nextItems = items.map((item) => {
    const before = JSON.stringify(collectPhotoUrlsFromItem(item));
    const next = remapItemPhotoUrls(item, urlMap);
    const after = JSON.stringify(collectPhotoUrlsFromItem(next));
    if (before !== after) itemsUpdated++;
    return next;
  });
  const nextTrash = trash.map((item) => {
    const before = JSON.stringify(collectPhotoUrlsFromItem(item));
    const next = remapItemPhotoUrls(item, urlMap);
    const after = JSON.stringify(collectPhotoUrlsFromItem(next));
    if (before !== after) itemsUpdated++;
    return next;
  });

  return {
    items: nextItems,
    trash: nextTrash,
    result: {
      uniquePhotosToArchive: urlList.length,
      photosArchived,
      photosFailed,
      itemsUpdated,
      failures,
    },
  };
}

/** Retry archiving one remote URL and apply the Storage URL to every item that uses it. */
export async function archiveSinglePhotoUrl(
  url: string,
  items: InventoryItem[],
  trash: InventoryItem[] = []
): Promise<{
  items: InventoryItem[];
  trash: InventoryItem[];
  success: boolean;
  error?: string;
  persistedUrl?: string;
}> {
  if (!canUploadToCloud()) {
    throw new Error('Sign in with Google to archive photos.');
  }
  const trimmed = url.trim();
  clearPhotoArchiveCacheForUrl(trimmed);
  try {
    const persisted = await persistOneInventoryImageUrl(trimmed, 'shared', { force: true });
    if (!isFirebaseStorageInventoryUrl(persisted) || persisted === trimmed) {
      const probe = await probePhotoArchiveUrl(trimmed);
      return {
        items,
        trash,
        success: false,
        error: probe.error || 'Could not archive this photo',
      };
    }
    const urlMap = new Map([[trimmed, persisted]]);
    return {
      items: items.map((item) => remapItemPhotoUrls(item, urlMap)),
      trash: trash.map((item) => remapItemPhotoUrls(item, urlMap)),
      success: true,
      persistedUrl: persisted,
    };
  } catch (e) {
    return {
      items,
      trash,
      success: false,
      error: (e as Error)?.message || 'Archive failed',
    };
  }
}

async function hashBlob(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 20);
}

async function fetchRemoteImageBlob(url: string): Promise<Blob> {
  const variants = remotePhotoFetchVariants(url);
  let lastError = 'Could not download image';

  for (const candidate of variants) {
    try {
      const direct = await fetch(candidate, { mode: 'cors', credentials: 'omit' });
      if (direct.ok) {
        const blob = await direct.blob();
        if (blob.type.startsWith('image/') && blob.size > 32) return blob;
      }
    } catch {
      /* try proxy */
    }

    const proxyUrl = `/api/images?route=fetch&url=${encodeURIComponent(candidate)}`;
    try {
      const proxied = await fetch(proxyUrl);
      if (!proxied.ok) {
        let detail = `HTTP ${proxied.status}`;
        try {
          const err = (await proxied.json()) as { error?: string };
          if (err?.error) detail = err.error;
        } catch {
          /* binary error body */
        }
        lastError = detail;
        continue;
      }
      const blob = await proxied.blob();
      if (blob.size > 32) return blob;
      lastError = 'Downloaded image was empty.';
    } catch (e) {
      lastError = (e as Error)?.message || lastError;
    }
  }

  throw new Error(`Could not download image: ${lastError}`);
}

async function blobToPersistedUrl(blob: Blob, itemId: string): Promise<string> {
  const jpeg = await compressBlobToJpeg(blob, INVENTORY_PHOTO_STORAGE_OPTIONS);

  if (canUploadToCloud()) {
    const hash = await hashBlob(jpeg);
    const folder = itemId.trim() || 'shared';
    const fileName = `${hash}.jpg`;
    return uploadItemImageBlob(jpeg, folder, fileName);
  }

  return compressBlobToLocalDataUrl(jpeg, INVENTORY_PHOTO_LOCAL_OPTIONS);
}

async function persistOneInventoryImageUrl(
  url: string,
  itemId: string,
  options?: { force?: boolean }
): Promise<string> {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;

  if (isFirebaseStorageInventoryUrl(trimmed)) return trimmed;

  if (!options?.force) {
    const cached = sourceUrlCache.get(trimmed);
    if (cached) return cached;

    const inflight = inFlightBySource.get(trimmed);
    if (inflight) return inflight;
  }

  const work = (async () => {
    let result = trimmed;

    if (isDataImageUrl(trimmed)) {
      if (canUploadToCloud()) {
        const blob = await compressDataUrlToBlob(trimmed, INVENTORY_PHOTO_STORAGE_OPTIONS);
        const hash = await hashBlob(blob);
        result = await uploadItemImageBlob(blob, itemId.trim() || 'shared', `${hash}.jpg`);
      } else {
        const blob = await compressDataUrlToBlob(trimmed, INVENTORY_PHOTO_LOCAL_OPTIONS);
        result = await dataUrlFromBlob(blob);
      }
    } else if (isRemoteHttpUrl(trimmed)) {
      const remote = await fetchRemoteImageBlob(trimmed);
      result = await blobToPersistedUrl(remote, itemId);
    }

    sourceUrlCache.set(trimmed, result);
    return result;
  })();

  inFlightBySource.set(trimmed, work);
  try {
    return await work;
  } finally {
    inFlightBySource.delete(trimmed);
  }
}

/** Download, compress, and persist a list of inventory photo URLs. */
export async function persistInventoryImages(
  urls: string[],
  options?: PersistInventoryImagesOptions
): Promise<string[]> {
  const itemId = options?.itemId?.trim() || 'shared';
  const total = urls.length;
  const out: string[] = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    try {
      out.push(await persistOneInventoryImageUrl(url, itemId));
    } catch (err) {
      console.warn('persistInventoryImages: keeping original URL after failure', url, err);
      out.push(url.trim());
    }
    options?.onProgress?.(i + 1, total);
  }

  return out;
}

/** Compress uploaded files and persist to Storage (or local data URL fallback). */
export async function persistInventoryImageFiles(
  files: File[],
  options?: PersistInventoryImagesOptions
): Promise<string[]> {
  const itemId = options?.itemId?.trim() || 'shared';
  const total = files.length;
  const out: string[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      const blob = await compressImageFileToBlob(file, INVENTORY_PHOTO_STORAGE_OPTIONS);
      if (canUploadToCloud()) {
        const hash = await hashBlob(blob);
        out.push(await uploadItemImageBlob(blob, itemId, `${hash}.jpg`));
      } else {
        out.push(await dataUrlFromBlob(blob));
      }
    } catch (err) {
      console.warn('persistInventoryImageFiles failed for', file.name, err);
      throw err;
    }
    options?.onProgress?.(i + 1, total);
  }

  return out;
}

/** Persist sale-proof screenshot (eBay order, Kleinanzeigen chat) to Firebase Storage or compressed data URL. */
export async function persistSaleProofImage(source: string, itemId: string): Promise<string> {
  const trimmed = source.trim();
  if (!trimmed) return '';
  if (isFirebaseStorageInventoryUrl(trimmed)) return trimmed;
  return persistOneInventoryImageUrl(trimmed, itemId.trim() || 'shared');
}
