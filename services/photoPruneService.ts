/**
 * Photo Storage Optimization & Auto-Pruning Service
 * 
 * Automatically cleans up heavy photos of sold items (> 30 days)
 * to keep Supabase Storage well within the 1 GB Free Tier limit,
 * while preserving all accounting, profit, and inventory history forever.
 */

import type { InventoryItem } from '../types';
import { ItemStatus } from '../types';
import { getSupabase, isSupabaseConfigured } from './supabaseService';

export interface PrunablePhotosSummary {
  eligibleItemsCount: number;
  totalPhotosCount: number;
  estimatedBytesSaved: number;
  itemIds: string[];
}

export interface PruneResult {
  itemsCleanedCount: number;
  filesDeletedCount: number;
  updatedItems: InventoryItem[];
}

const LAST_PRUNE_KEY = 'deinv_last_photo_prune_timestamp';
const PRUNE_ENABLED_KEY = 'deinv_auto_photo_prune_enabled';

export function isAutoPhotoPruneEnabled(): boolean {
  try {
    const val = localStorage.getItem(PRUNE_ENABLED_KEY);
    return val !== 'false'; // Enabled by default
  } catch {
    return true;
  }
}

export function setAutoPhotoPruneEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(PRUNE_ENABLED_KEY, enabled ? 'true' : 'false');
  } catch {
    // ignore
  }
}

/**
 * Analyzes items to find sold products older than cutoff days that still hold photos.
 */
export function analyzePrunableSoldPhotos(
  items: InventoryItem[],
  daysThreshold = 30
): PrunablePhotosSummary {
  const cutoffTime = Date.now() - daysThreshold * 24 * 60 * 60 * 1000;
  let totalPhotos = 0;
  const eligibleItemIds: string[] = [];

  for (const item of items) {
    if (item.status !== ItemStatus.SOLD && item.status !== 'Sold') continue;
    if (!item.sellDate) continue;

    const sellTime = new Date(item.sellDate).getTime();
    if (isNaN(sellTime) || sellTime > cutoffTime) continue;

    let photoCount = 0;
    if (item.imageUrl && item.imageUrl.trim().length > 0) photoCount++;
    if (Array.isArray(item.imageUrls)) {
      photoCount += item.imageUrls.filter(u => u && u.trim().length > 0).length;
    }
    if (Array.isArray(item.storeGalleryUrls)) {
      photoCount += item.storeGalleryUrls.filter(u => u && u.trim().length > 0).length;
    }

    if (photoCount > 0) {
      eligibleItemIds.push(item.id);
      totalPhotos += photoCount;
    }
  }

  // Estimated ~100 KB per photo average compressed size
  const estimatedBytesSaved = totalPhotos * 100 * 1024;

  return {
    eligibleItemsCount: eligibleItemIds.length,
    totalPhotosCount: totalPhotos,
    estimatedBytesSaved,
    itemIds: eligibleItemIds,
  };
}

/**
 * Extracts Supabase Storage file paths from image URLs.
 */
function extractStoragePaths(urls: string[]): string[] {
  const paths: string[] = [];
  for (const url of urls) {
    if (!url || typeof url !== 'string') continue;
    const match = url.match(/\/inventory-images\/(.+)$/);
    if (match && match[1]) {
      const cleanPath = decodeURIComponent(match[1].split('?')[0]);
      paths.push(cleanPath);
    }
  }
  return paths;
}

/**
 * Deletes photos from Supabase Storage and clears image references from PostgreSQL,
 * preserving all financial and item history.
 */
export async function pruneOldSoldItemPhotos(
  items: InventoryItem[],
  daysThreshold = 30,
  onProgress?: (cleaned: number, total: number) => void
): Promise<PruneResult> {
  const analysis = analyzePrunableSoldPhotos(items, daysThreshold);
  if (analysis.eligibleItemsCount === 0) {
    return { itemsCleanedCount: 0, filesDeletedCount: 0, updatedItems: items };
  }

  const sb = isSupabaseConfigured() ? getSupabase() : null;
  const eligibleSet = new Set(analysis.itemIds);
  const updatedItems: InventoryItem[] = [];
  let filesDeletedCount = 0;
  let itemsCleanedCount = 0;

  const filesToDelete: string[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!eligibleSet.has(item.id)) {
      updatedItems.push(item);
      continue;
    }

    const photoUrls = [
      item.imageUrl,
      ...(item.imageUrls || []),
      ...(item.storeGalleryUrls || [])
    ].filter((u): u is string => typeof u === 'string' && u.trim().length > 0);

    const paths = extractStoragePaths(photoUrls);
    filesToDelete.push(...paths);

    // Create item with stripped photos but untouched financial data
    const cleanedItem: InventoryItem = {
      ...item,
      imageUrl: undefined,
      imageUrls: [],
      storeGalleryUrls: [],
    };

    updatedItems.push(cleanedItem);
    itemsCleanedCount++;
    onProgress?.(itemsCleanedCount, analysis.eligibleItemsCount);
  }

  // 1. Delete physical files from Supabase Storage in batches of 100
  if (sb && filesToDelete.length > 0) {
    const BATCH = 100;
    for (let i = 0; i < filesToDelete.length; i += BATCH) {
      const chunk = filesToDelete.slice(i, i + BATCH);
      const { data, error } = await sb.storage.from('inventory-images').remove(chunk);
      if (!error && data) {
        filesDeletedCount += data.length;
      }
    }
  }

  // 2. Batch update PostgreSQL records
  if (sb && analysis.itemIds.length > 0) {
    const BATCH = 100;
    for (let i = 0; i < analysis.itemIds.length; i += BATCH) {
      const chunkIds = analysis.itemIds.slice(i, i + BATCH);
      await sb
        .from('inventory_items')
        .update({
          image_url: null,
          image_urls: [],
          store_gallery_urls: [],
          updated_at: new Date().toISOString(),
        })
        .in('id', chunkIds);
    }
  }

  try {
    localStorage.setItem(LAST_PRUNE_KEY, Date.now().toString());
  } catch {
    // ignore
  }

  return {
    itemsCleanedCount,
    filesDeletedCount: filesDeletedCount || filesToDelete.length,
    updatedItems,
  };
}

/**
 * Runs weekly background auto-prune if enabled and due (> 7 days since last run).
 */
export async function runWeeklyPhotoPruneIfDue(
  items: InventoryItem[],
  onItemsUpdated?: (updatedItems: InventoryItem[]) => void
): Promise<boolean> {
  if (!isAutoPhotoPruneEnabled()) return false;

  try {
    const lastStr = localStorage.getItem(LAST_PRUNE_KEY);
    const lastTime = lastStr ? parseInt(lastStr, 10) : 0;
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

    if (Date.now() - lastTime < WEEK_MS) {
      return false; // Not due yet
    }

    console.log('[photoPrune] Checking for sold photos older than 30 days...');
    const analysis = analyzePrunableSoldPhotos(items, 30);
    if (analysis.eligibleItemsCount === 0) {
      localStorage.setItem(LAST_PRUNE_KEY, Date.now().toString());
      return false;
    }

    console.log(`[photoPrune] Auto-pruning ${analysis.totalPhotosCount} photos from ${analysis.eligibleItemsCount} sold items...`);
    const result = await pruneOldSoldItemPhotos(items, 30);
    if (result.itemsCleanedCount > 0 && onItemsUpdated) {
      onItemsUpdated(result.updatedItems);
      console.log(`[photoPrune] Successfully pruned ${result.filesDeletedCount} photos. Saved ~${Math.round(analysis.estimatedBytesSaved / 1024)} KB.`);
    }
    return true;
  } catch (err) {
    console.warn('[photoPrune] Background prune failed (non-fatal):', err);
    return false;
  }
}
