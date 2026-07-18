/**
 * Gallery history for AI-generated product cards.
 * Prefers Firebase Storage (high quality) + Firestore metadata when signed in;
 * falls back to localStorage so generations are never discarded silently.
 */

import type { GeneratedProductCardEntry } from '../types';
import {
  compressBlobToJpeg,
  dataUrlFromBlob,
} from '../utils/imageCompress';
import {
  deleteProductCardGalleryEntry,
  fetchProductCardGalleryEntries,
  getCurrentUser,
  isCloudEnabled,
  uploadProductCardBlob,
  writeProductCardGalleryEntry,
} from './firebaseService';

const LOCAL_KEY = 'dein_product_card_gallery_v1';
const MAX_LOCAL_ENTRIES = 80;
/** Prefer keeping PNG when under this size; otherwise high-quality JPEG. */
const MAX_PNG_BYTES = 3_200_000;
const HQ_JPEG = {
  maxWidth: 2048,
  maxHeight: 2048,
  quality: 0.95,
  maxBlobBytes: 2_800_000,
};

export interface SaveGeneratedCardInput {
  itemId: string;
  itemName: string;
  dataUrl: string;
  provider?: string;
  model?: string;
  styleId?: string;
  styleName?: string;
}

function canUploadToCloud(): boolean {
  return isCloudEnabled() && Boolean(getCurrentUser());
}

function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('Invalid image data');
  const header = dataUrl.slice(0, comma);
  const b64 = dataUrl.slice(comma + 1);
  const mime = header.match(/data:([^;]+)/)?.[1] || 'image/png';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function readLocal(): GeneratedProductCardEntry[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as GeneratedProductCardEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocal(entries: GeneratedProductCardEntry[]): void {
  const trimmed = entries
    .slice()
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, MAX_LOCAL_ENTRIES);
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(trimmed));
  } catch {
    // Quota — drop oldest data-URL entries first
    const lean = trimmed.filter((e) => e.cloudStored || !e.imageUrl.startsWith('data:'));
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(lean.slice(0, 40)));
    } catch {
      /* ignore */
    }
  }
}

function upsertLocal(entry: GeneratedProductCardEntry): void {
  const list = readLocal().filter((e) => e.id !== entry.id);
  list.unshift(entry);
  writeLocal(list);
}

async function prepareHighQualityBlob(dataUrl: string): Promise<{ blob: Blob; fileName: string }> {
  const raw = dataUrlToBlob(dataUrl);
  const isPng = (raw.type || '').includes('png');
  if (isPng && raw.size <= MAX_PNG_BYTES) {
    return { blob: raw, fileName: `card-${Date.now()}.png` };
  }
  if (!isPng && raw.size <= MAX_PNG_BYTES) {
    const ext = (raw.type || '').includes('webp') ? 'webp' : 'jpg';
    return { blob: raw, fileName: `card-${Date.now()}.${ext}` };
  }
  const jpeg = await compressBlobToJpeg(raw, HQ_JPEG);
  return { blob: jpeg, fileName: `card-${Date.now()}.jpg` };
}

/**
 * Persist a freshly generated card (high quality in Storage when signed in).
 */
export async function saveGeneratedProductCard(
  input: SaveGeneratedCardInput
): Promise<GeneratedProductCardEntry> {
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `card_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const createdAt = new Date().toISOString();
  let imageUrl = input.dataUrl;
  let cloudStored = false;

  if (canUploadToCloud()) {
    try {
      const { blob, fileName } = await prepareHighQualityBlob(input.dataUrl);
      imageUrl = await uploadProductCardBlob(blob, input.itemId, fileName);
      cloudStored = true;
    } catch (err) {
      console.warn('Product card cloud upload failed, keeping local copy:', err);
      // Keep original data URL locally so the paid generation is not lost
      try {
        const { blob } = await prepareHighQualityBlob(input.dataUrl);
        imageUrl = await dataUrlFromBlob(blob);
      } catch {
        imageUrl = input.dataUrl;
      }
    }
  } else {
    // Local-only: keep a high-quality but storage-friendly copy
    try {
      const { blob } = await prepareHighQualityBlob(input.dataUrl);
      if (blob.size < input.dataUrl.length * 0.75 || blob.type.includes('jpeg')) {
        imageUrl = await dataUrlFromBlob(blob);
      }
    } catch {
      imageUrl = input.dataUrl;
    }
  }

  const entry: GeneratedProductCardEntry = {
    id,
    itemId: input.itemId,
    itemName: input.itemName,
    imageUrl,
    createdAt,
    provider: input.provider,
    model: input.model,
    styleId: input.styleId,
    styleName: input.styleName,
    cloudStored,
  };

  upsertLocal(entry);

  if (canUploadToCloud() && cloudStored) {
    try {
      await writeProductCardGalleryEntry(entry);
    } catch (err) {
      console.warn('Product card gallery metadata write failed:', err);
    }
  }

  return entry;
}

/** Merge cloud + local gallery; newest first. Optionally filter by item. */
export async function listProductCardGallery(
  itemId?: string
): Promise<GeneratedProductCardEntry[]> {
  const local = readLocal();
  let cloud: GeneratedProductCardEntry[] = [];
  if (canUploadToCloud()) {
    try {
      cloud = await fetchProductCardGalleryEntries(itemId);
    } catch (err) {
      console.warn('Product card gallery cloud fetch failed:', err);
    }
  }

  const byId = new Map<string, GeneratedProductCardEntry>();
  for (const e of local) {
    if (itemId && e.itemId !== itemId) continue;
    byId.set(e.id, e);
  }
  for (const e of cloud) {
    if (itemId && e.itemId !== itemId) continue;
    const prev = byId.get(e.id);
    // Prefer cloud URL when both exist
    if (!prev || (e.cloudStored && e.imageUrl.startsWith('http'))) {
      byId.set(e.id, e);
    }
  }

  return Array.from(byId.values()).sort((a, b) =>
    (b.createdAt || '').localeCompare(a.createdAt || '')
  );
}

export async function removeProductCardFromGallery(id: string): Promise<void> {
  writeLocal(readLocal().filter((e) => e.id !== id));
  if (canUploadToCloud()) {
    try {
      await deleteProductCardGalleryEntry(id);
    } catch (err) {
      console.warn('Product card gallery cloud delete failed:', err);
    }
  }
}

export function isProductCardGalleryCloudReady(): boolean {
  return canUploadToCloud();
}
