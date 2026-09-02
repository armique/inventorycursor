/**
 * Local (id → updated_at) manifest for Supabase inventory_items.
 * Stored in IndexedDB so reopening the app can run a cheap delta read instead of
 * re-downloading every row.
 */
const DB_NAME = 'inventory-pro-store';
const DB_VERSION = 1;
const STORE_NAME = 'kv';
const MANIFEST_KEY = 'inventory_cloud_manifest';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function readInventoryCloudManifest(): Promise<Map<string, string>> {
  try {
    const db = await openDB();
    const raw = await new Promise<Record<string, string> | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(MANIFEST_KEY);
      req.onsuccess = () => resolve((req.result as Record<string, string> | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
    if (!raw) return new Map();
    return new Map(Object.entries(raw));
  } catch (e) {
    console.warn('[inventoryCloudManifest] read failed:', e);
    return new Map();
  }
}

export async function writeInventoryCloudManifest(manifest: ReadonlyMap<string, string>): Promise<void> {
  try {
    const db = await openDB();
    const obj = Object.fromEntries(manifest);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(obj, MANIFEST_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('[inventoryCloudManifest] write failed:', e);
  }
}

export async function patchInventoryCloudManifest(
  rows: ReadonlyArray<{ id: string; updated_at: string }>
): Promise<void> {
  if (!rows.length) return;
  const manifest = await readInventoryCloudManifest();
  for (const row of rows) {
    if (row.id && row.updated_at) manifest.set(String(row.id), String(row.updated_at));
  }
  await writeInventoryCloudManifest(manifest);
}

export async function removeIdsFromInventoryCloudManifest(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const manifest = await readInventoryCloudManifest();
  let changed = false;
  for (const id of ids) {
    if (manifest.delete(id)) changed = true;
  }
  if (changed) await writeInventoryCloudManifest(manifest);
}
