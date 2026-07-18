/**
 * Gallery history for AI-generated product cards.
 * Always keeps a durable local copy in IndexedDB first (so paid gens are never lost),
 * then uploads high-quality files to Firebase Storage when signed in.
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
const MAX_LOCAL_ENTRIES = 120;
const IDB_NAME = 'dein_product_card_gallery_idb';
const IDB_STORE = 'images';
const IDB_PREFIX = 'idb:';
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

export interface ProductCardGalleryGroup {
  itemId: string;
  itemName: string;
  entries: GeneratedProductCardEntry[];
}

function canUploadToCloud(): boolean {
  return isCloudEnabled() && Boolean(getCurrentUser());
}

function slugPart(value: string, max = 48): string {
  return (value || 'card')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '') || 'card';
}

/** Download / Storage file name that matches the generated card (easy to find later). */
export function buildProductCardFileName(
  itemName: string,
  styleName?: string,
  createdAt?: string,
  ext = 'png'
): string {
  const date = (createdAt || new Date().toISOString()).slice(0, 10);
  const style = slugPart(styleName || 'ai-card', 28);
  const name = slugPart(itemName, 56);
  return `${name}__${style}__${date}.${ext}`;
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

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

async function idbPut(id: string, blob: Blob): Promise<void> {
  const db = await openIdb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
    });
  } finally {
    db.close();
  }
}

async function idbGet(id: string): Promise<Blob | null> {
  const db = await openIdb();
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(id);
      req.onsuccess = () => resolve((req.result as Blob) || null);
      req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
    });
  } finally {
    db.close();
  }
}

async function idbDelete(id: string): Promise<void> {
  try {
    const db = await openIdb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('IndexedDB delete failed'));
      });
    } finally {
      db.close();
    }
  } catch {
    /* ignore */
  }
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
    .slice(0, MAX_LOCAL_ENTRIES)
    // Never keep huge data URLs in localStorage metadata — use idb:/https only
    .map((e) =>
      e.imageUrl?.startsWith('data:')
        ? { ...e, imageUrl: `${IDB_PREFIX}${e.id}` }
        : e
    );
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(trimmed));
  } catch {
    const lean = trimmed.filter((e) => !String(e.imageUrl || '').startsWith('data:'));
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(lean.slice(0, 60)));
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

async function prepareHighQualityBlob(
  dataUrl: string,
  itemName: string,
  styleName?: string,
  createdAt?: string
): Promise<{ blob: Blob; fileName: string }> {
  const raw = dataUrlToBlob(dataUrl);
  const isPng = (raw.type || '').includes('png');
  if (isPng && raw.size <= MAX_PNG_BYTES) {
    return {
      blob: raw,
      fileName: buildProductCardFileName(itemName, styleName, createdAt, 'png'),
    };
  }
  if (!isPng && raw.size <= MAX_PNG_BYTES) {
    const ext = (raw.type || '').includes('webp') ? 'webp' : 'jpg';
    return {
      blob: raw,
      fileName: buildProductCardFileName(itemName, styleName, createdAt, ext),
    };
  }
  const jpeg = await compressBlobToJpeg(raw, HQ_JPEG);
  return {
    blob: jpeg,
    fileName: buildProductCardFileName(itemName, styleName, createdAt, 'jpg'),
  };
}

/**
 * Persist a freshly generated card.
 * Order: IndexedDB (always) → Firebase Storage (if signed in) → metadata.
 */
export async function saveGeneratedProductCard(
  input: SaveGeneratedCardInput
): Promise<GeneratedProductCardEntry> {
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `card_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const createdAt = new Date().toISOString();
  const { blob, fileName } = await prepareHighQualityBlob(
    input.dataUrl,
    input.itemName,
    input.styleName,
    createdAt
  );

  // 1) Guaranteed local durable copy (survives refresh; avoids localStorage quota crashes)
  await idbPut(id, blob);

  let imageUrl = `${IDB_PREFIX}${id}`;
  let cloudStored = false;

  // 2) Cloud high-quality upload
  if (canUploadToCloud()) {
    try {
      imageUrl = await uploadProductCardBlob(blob, input.itemId, fileName);
      cloudStored = true;
    } catch (err) {
      console.warn('Product card cloud upload failed; IndexedDB copy kept:', err);
      imageUrl = `${IDB_PREFIX}${id}`;
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
    fileName,
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

/** Resolve entry to a usable image URL (http, data, or object URL from IndexedDB). */
export async function resolveProductCardImageUrl(
  entry: GeneratedProductCardEntry
): Promise<string> {
  const url = (entry.imageUrl || '').trim();
  if (!url) throw new Error('Gallery entry has no image');
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
    return url;
  }
  if (url.startsWith(IDB_PREFIX) || url === `${IDB_PREFIX}${entry.id}`) {
    const blob = await idbGet(entry.id);
    if (!blob) throw new Error('Local gallery image missing — was browser data cleared?');
    return dataUrlFromBlob(blob);
  }
  // Legacy: imageUrl might be bare id
  if (!url.includes(':') && !url.includes('/')) {
    const blob = await idbGet(url);
    if (blob) return dataUrlFromBlob(blob);
  }
  return url;
}

/** Blob for download with the generated file name. */
export async function getProductCardBlob(
  entry: GeneratedProductCardEntry
): Promise<{ blob: Blob; fileName: string }> {
  const url = (entry.imageUrl || '').trim();
  const fileName =
    entry.fileName ||
    buildProductCardFileName(
      entry.itemName,
      entry.styleName,
      entry.createdAt,
      url.includes('png') ? 'png' : 'jpg'
    );

  if (url.startsWith(IDB_PREFIX) || (!url.startsWith('http') && !url.startsWith('data:'))) {
    const blob = (await idbGet(entry.id)) || (await idbGet(url.replace(IDB_PREFIX, '')));
    if (blob) return { blob, fileName };
  }
  if (url.startsWith('data:')) {
    return { blob: dataUrlToBlob(url), fileName };
  }
  if (url.startsWith('http')) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Could not download gallery image');
    return { blob: await res.blob(), fileName };
  }
  throw new Error('Could not resolve gallery image');
}

function triggerBlobDownload(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = fileName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 2500);
  }
}

export async function downloadProductCardEntry(entry: GeneratedProductCardEntry): Promise<void> {
  const { blob, fileName } = await getProductCardBlob(entry);
  triggerBlobDownload(blob, fileName);
}

function uniquifyFileNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = seen.get(name) || 0;
    seen.set(name, count + 1);
    if (count === 0) return name;
    const dot = name.lastIndexOf('.');
    if (dot <= 0) return `${name}-${count + 1}`;
    return `${name.slice(0, dot)}-${count + 1}${name.slice(dot)}`;
  });
}

/**
 * Download every card for a product (or any entry list), one file after another.
 * Filenames stay product/style-based; duplicates get -2, -3 suffixes.
 */
export async function downloadProductCardEntries(
  entries: GeneratedProductCardEntry[],
  options?: { onProgress?: (done: number, total: number) => void }
): Promise<{ ok: number; failed: number }> {
  const list = entries.filter(Boolean);
  if (!list.length) return { ok: 0, failed: 0 };

  const prepared: Array<{ blob: Blob; fileName: string } | null> = [];
  for (const entry of list) {
    try {
      prepared.push(await getProductCardBlob(entry));
    } catch {
      prepared.push(null);
    }
  }

  const okNames = uniquifyFileNames(
    prepared.map((p, i) => p?.fileName || `card-${i + 1}.jpg`)
  );

  let ok = 0;
  let failed = 0;
  for (let i = 0; i < prepared.length; i++) {
    const row = prepared[i];
    if (!row) {
      failed++;
      options?.onProgress?.(i + 1, prepared.length);
      continue;
    }
    try {
      triggerBlobDownload(row.blob, okNames[i]!);
      ok++;
      // Brief gap so browsers don't coalesce / block multiple downloads
      await new Promise((r) => setTimeout(r, 280));
    } catch {
      failed++;
    }
    options?.onProgress?.(i + 1, prepared.length);
  }

  return { ok, failed };
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
    if (!prev || (e.cloudStored && e.imageUrl.startsWith('http'))) {
      byId.set(e.id, { ...prev, ...e, fileName: e.fileName || prev?.fileName });
    }
  }

  return Array.from(byId.values()).sort((a, b) =>
    (b.createdAt || '').localeCompare(a.createdAt || '')
  );
}

export function groupProductCardGalleryByItem(
  entries: GeneratedProductCardEntry[]
): ProductCardGalleryGroup[] {
  const map = new Map<string, ProductCardGalleryGroup>();
  for (const e of entries) {
    const key = e.itemId || 'unknown';
    let g = map.get(key);
    if (!g) {
      g = { itemId: key, itemName: e.itemName || 'Unknown item', entries: [] };
      map.set(key, g);
    }
    if (e.itemName && e.itemName !== 'Unknown item') g.itemName = e.itemName;
    g.entries.push(e);
  }
  return Array.from(map.values())
    .map((g) => ({
      ...g,
      entries: g.entries
        .slice()
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    }))
    .sort((a, b) => {
      const aAt = a.entries[0]?.createdAt || '';
      const bAt = b.entries[0]?.createdAt || '';
      return bAt.localeCompare(aAt);
    });
}

export async function removeProductCardFromGallery(id: string): Promise<void> {
  writeLocal(readLocal().filter((e) => e.id !== id));
  await idbDelete(id);
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

export function isProductCardIdbUrl(url: string): boolean {
  return (url || '').startsWith(IDB_PREFIX);
}
