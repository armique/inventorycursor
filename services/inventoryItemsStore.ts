/**
 * Inventory items live in IndexedDB, not localStorage. localStorage has a fixed ~5MB
 * per-origin cap that does not grow with available disk space; IndexedDB's quota is
 * disk-backed (typically GBs) and was sitting almost entirely unused while
 * localStorage silently hit its ceiling and started failing every save.
 *
 * A tiny "pending patches" log stays in localStorage as a synchronous, always-succeeds
 * write-ahead log: every edit is recorded there the instant it happens (see
 * appendPendingItemPatches), before the slower async IndexedDB write even starts. If the
 * browser crashes or the tab is refreshed between two IndexedDB writes, the patch log —
 * not the last full IndexedDB snapshot — is the source of truth for what changed, and it
 * gets replayed on the next boot. It only ever holds recently-changed items, so it can
 * never come close to the localStorage cap the way the full item list did.
 */
import type { InventoryItem } from '../types';

const DB_NAME = 'inventory-pro-store';
const DB_VERSION = 1;
const STORE_NAME = 'kv';
const ITEMS_KEY = 'inventory_items';
const PENDING_PATCH_KEY = 'inventory_items_pending_patches';
/** Bumped in localStorage (tiny) whenever IndexedDB items change, so other tabs' native
 *  `storage` listener has something to react to — IndexedDB itself has no such event. */
const REV_KEY = 'inventory_items_rev';

/**
 * Multi-tab write guard: each tab remembers the rev it last saw (at boot, and after each
 * of its own successful writes). If another tab has saved since, this tab's rev goes stale
 * and it must stop writing — otherwise its older in-memory snapshot would silently
 * overwrite the other tab's newer save the next time this tab's debounced save fires.
 * Cross-tab *live* merging into a running UI was tried before and caused real data loss
 * (see App.tsx); this only ever blocks a write, it never rewrites what's on screen.
 */
let boundRev = '';
let staleTabDetected = false;
let onStaleTab: (() => void) | null = null;

function readRev(): string {
  try {
    return localStorage.getItem(REV_KEY) || '';
  } catch {
    return boundRev;
  }
}

/** Call once at boot, after this tab has loaded its items snapshot. */
export function bindInventoryItemsRevBaseline(): void {
  boundRev = readRev();
  staleTabDetected = false;
}

export function isInventoryItemsTabStale(): boolean {
  return staleTabDetected;
}

/** Registers the callback fired the first time this tab detects it is stale. */
export function setInventoryItemsStaleListener(cb: (() => void) | null): void {
  onStaleTab = cb;
}

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

export async function readInventoryItemsFromDB(): Promise<InventoryItem[] | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(ITEMS_KEY);
      req.onsuccess = () => resolve((req.result as InventoryItem[] | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('[inventoryItemsStore] IndexedDB read failed:', e);
    return null;
  }
}

async function writeItemsTransaction(items: InventoryItem[]): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(items, ITEMS_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

let latestItems: InventoryItem[] | null = null;
let writeLoop: Promise<void> | null = null;

/**
 * Two debounced saves can end up overlapping — each independently waits for a "quiet"
 * moment before it actually writes (see backgroundPersistence.ts), and those waits can
 * resolve in either order regardless of which edit happened first. Without coalescing,
 * an older save finishing *after* a newer one would silently overwrite fresher data with
 * stale data. This always converges on whatever `items` was passed most recently,
 * looping until nothing newer has arrived since the write in flight started.
 *
 * The rev-key nudge (see INVENTORY_ITEMS_REV_KEY) fires only once, after the loop fully
 * drains — bumping it per iteration let other tabs react to an *intermediate* write from
 * partway through the loop, which could still be missing the very edit the loop was
 * started for. That showed up as the linked order briefly disappearing and reappearing
 * in another tab: it applied the stale intermediate state, then the real one right after.
 */
export function writeInventoryItemsToDB(items: InventoryItem[]): Promise<void> {
  if (staleTabDetected) return Promise.resolve();
  latestItems = items;
  if (writeLoop) return writeLoop;
  writeLoop = (async () => {
    while (latestItems) {
      if (readRev() !== boundRev) {
        // Another tab has saved since we loaded — abandon this write rather than
        // clobber its newer data with our older in-memory snapshot.
        staleTabDetected = true;
        latestItems = null;
        writeLoop = null;
        try {
          onStaleTab?.();
        } catch {
          /* listener errors must not break the store */
        }
        return;
      }
      const toWrite = latestItems;
      latestItems = null;
      await writeItemsTransaction(toWrite);
    }
    writeLoop = null;
    try {
      const nextRev = String(Date.now());
      localStorage.setItem(REV_KEY, nextRev);
      boundRev = nextRev;
    } catch {
      /* non-critical — other tabs just won't get an instant nudge this time */
    }
  })();
  return writeLoop;
}

export const INVENTORY_ITEMS_REV_KEY = REV_KEY;

/** Synchronous and tiny — safe against the localStorage quota that broke the old full-array write. */
export function appendPendingItemPatches(items: InventoryItem[]): void {
  if (!items.length) return;
  try {
    const raw = localStorage.getItem(PENDING_PATCH_KEY);
    const map: Record<string, InventoryItem> = raw ? JSON.parse(raw) : {};
    for (const item of items) map[item.id] = item;
    localStorage.setItem(PENDING_PATCH_KEY, JSON.stringify(map));
  } catch (e) {
    console.warn('[inventoryItemsStore] Could not append pending patch:', e);
  }
}

export function readPendingItemPatches(): InventoryItem[] {
  try {
    const raw = localStorage.getItem(PENDING_PATCH_KEY);
    if (!raw) return [];
    return Object.values(JSON.parse(raw) as Record<string, InventoryItem>);
  } catch {
    return [];
  }
}

export function clearPendingItemPatches(): void {
  try {
    localStorage.removeItem(PENDING_PATCH_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Boot-time load: IndexedDB is the source of truth. Falls back to migrating the old
 * localStorage blob (pre-existing installs) if IndexedDB is empty, and to the last
 * resort of localStorage directly if IndexedDB is unavailable (e.g. some private-mode
 * configurations).
 */
export async function loadInventoryItemsForBoot(): Promise<InventoryItem[]> {
  // Capture the rev this tab is booting against *before* any migration write below can
  // bump it, so that write is still judged against the pre-boot rev like every other tab.
  bindInventoryItemsRevBaseline();

  const fromDB = await readInventoryItemsFromDB();
  if (fromDB) {
    // Migration already landed in IndexedDB (possibly on a prior boot) — the old
    // localStorage copy is now dead weight eating into the ~5MB quota for no reason.
    try {
      if (localStorage.getItem(ITEMS_KEY) !== null) localStorage.removeItem(ITEMS_KEY);
    } catch {
      /* non-critical cleanup */
    }
    return fromDB;
  }

  try {
    const raw = localStorage.getItem(ITEMS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as InventoryItem[];
      if (Array.isArray(parsed) && parsed.length) {
        await writeInventoryItemsToDB(parsed).catch((e) =>
          console.warn('[inventoryItemsStore] Migration write failed, will retry next boot:', e)
        );
        try {
          localStorage.removeItem(ITEMS_KEY);
        } catch {
          /* non-critical cleanup */
        }
        return parsed;
      }
    }
  } catch (e) {
    console.warn('[inventoryItemsStore] Legacy localStorage read failed:', e);
  }
  return [];
}

export async function purgeAllLocalData(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('[inventoryItemsStore] IndexedDB clear failed:', e);
  }

  const keysToRemove = [
    'inventory_items',
    'inventory_items_pending_patches',
    'inventory_items_rev',
    'inventory_trash',
    'inventory_expenses',
    'recurring_expenses',
    'action_history',
    'bulk_imports',
    'ebay_order_index',
    'ebay_tx_reports',
    'ebay_purchases',
    'ebay_purchases_index',
    'ebay_inventory_links',
    'deinventory_linked_orders',
    'three_d_print_cloud',
    'ai_sourcing_history',
    'price_check_history',
  ];

  for (const k of keysToRemove) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }
}

