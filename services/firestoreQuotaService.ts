/**
 * Measure / track Firestore + Storage usage against Spark free quotas.
 *
 * Important: item photos live in Firebase Storage (5 GB free), not Firestore (1 GiB docs).
 * The collapsed widget should lead with Storage for that reason.
 */

import {
  collection,
  getDocs,
} from 'firebase/firestore';
import {
  getMetadata,
  listAll,
  ref as storageRef,
  type FirebaseStorage,
} from 'firebase/storage';
import type { InventoryItem } from '../types';
import {
  getCurrentUser,
  getFirebaseConfig,
  getFirebaseContext,
} from './firebaseService';
import {
  getLocalFirestoreOpsToday,
  recordFirestoreReads,
} from './firestoreOpsCounter';
import {
  buildQuotaSnapshot,
  parseMonitoringQuotaResponse,
  type FirestoreFreeQuotaSnapshot,
  type MonitoringQuotaJson,
} from '../utils/firestoreFreeQuota';

const CACHE_KEY = 'deinv_firestore_quota_cache_v2';
const CACHE_TTL_MS = 5 * 60 * 1000;
/** Fallback average when metadata can't be read for a durable Storage URL. */
const AVG_COMPRESSED_IMAGE_BYTES = 180_000;

function jsonByteSize(obj: unknown): number {
  try {
    return new Blob([JSON.stringify(obj)]).size;
  } catch {
    return 0;
  }
}

function isFirebaseStorageUrl(url: string): boolean {
  const t = (url || '').trim();
  if (!t.startsWith('https://')) return false;
  return (
    t.includes('firebasestorage.googleapis.com') ||
    t.includes('firebasestorage.app') ||
    t.includes('.appspot.com')
  );
}

/** Collect durable Firebase Storage URLs from inventory items (main + galleries). */
export function collectStorageUrlsFromItems(
  items: Array<Pick<InventoryItem, 'imageUrl' | 'imageUrls' | 'storeGalleryUrls' | 'receiptUrl'>>
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string | undefined | null) => {
    const u = (raw || '').trim();
    if (!u || !isFirebaseStorageUrl(u) || seen.has(u)) return;
    seen.add(u);
    out.push(u);
  };
  for (const item of items) {
    push(item.imageUrl);
    for (const u of item.imageUrls || []) push(u);
    for (const u of item.storeGalleryUrls || []) push(u);
    push(item.receiptUrl);
  }
  return out;
}

async function sumCollectionDocBytes(
  pathSegments: string[]
): Promise<{ bytes: number; docs: number }> {
  const ctx = getFirebaseContext();
  if (!ctx?.db || pathSegments.length < 1) return { bytes: 0, docs: 0 };
  const col = collection(ctx.db, pathSegments[0]!, ...pathSegments.slice(1));
  const snap = await getDocs(col);
  recordFirestoreReads(Math.max(1, snap.size));
  let bytes = 0;
  snap.forEach((d) => {
    bytes += jsonByteSize(d.data());
  });
  return { bytes, docs: snap.size };
}

async function sumStoragePrefixBytes(
  storage: FirebaseStorage,
  prefix: string,
  maxFiles = 1200
): Promise<{ bytes: number; files: number; truncated: boolean }> {
  let bytes = 0;
  let files = 0;
  let truncated = false;

  const walk = async (path: string): Promise<void> => {
    if (files >= maxFiles) {
      truncated = true;
      return;
    }
    const root = storageRef(storage, path);
    let result;
    try {
      result = await listAll(root);
    } catch {
      return;
    }
    for (const item of result.items) {
      if (files >= maxFiles) {
        truncated = true;
        return;
      }
      try {
        const meta = await getMetadata(item);
        bytes += Number(meta.size) || 0;
        files += 1;
      } catch {
        files += 1;
      }
    }
    for (const pref of result.prefixes) {
      if (files >= maxFiles) {
        truncated = true;
        return;
      }
      await walk(pref.fullPath);
    }
  };

  await walk(prefix);
  return { bytes, files, truncated };
}

async function sumStorageUrlBytes(
  storage: FirebaseStorage,
  urls: string[],
  concurrency = 8
): Promise<{ bytes: number; files: number; sized: number }> {
  let bytes = 0;
  let sized = 0;
  let cursor = 0;

  const worker = async () => {
    while (cursor < urls.length) {
      const i = cursor++;
      const url = urls[i]!;
      try {
        const meta = await getMetadata(storageRef(storage, url));
        bytes += Number(meta.size) || 0;
        sized += 1;
      } catch {
        /* keep going — caller may apply average fallback */
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, () => worker()));
  return { bytes, files: urls.length, sized };
}

async function fetchMonitoringQuota(): Promise<MonitoringQuotaJson | null> {
  try {
    const cfg = getFirebaseConfig();
    const projectId = cfg?.projectId || '';
    const url = `/api/firestore-quota${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`;
    const res = await fetch(url, { method: 'GET', credentials: 'same-origin' });
    const json = await res.json().catch(() => null);
    if (!res.ok && !json) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return parseMonitoringQuotaResponse(json);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Monitoring fetch failed',
    };
  }
}

export async function collectFirestoreFreeQuotaSnapshot(options?: {
  force?: boolean;
  includeStorage?: boolean;
  includeMonitoring?: boolean;
  /** Local inventory — used to count Storage image URLs when folder list is incomplete. */
  items?: Array<Pick<InventoryItem, 'imageUrl' | 'imageUrls' | 'storeGalleryUrls' | 'receiptUrl'>>;
}): Promise<FirestoreFreeQuotaSnapshot> {
  const force = options?.force === true;
  const includeStorage = options?.includeStorage !== false;
  const includeMonitoring = options?.includeMonitoring !== false;
  const items = options?.items || [];

  if (!force) {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as { at: number; snapshot: FirestoreFreeQuotaSnapshot };
        if (parsed?.snapshot && Date.now() - parsed.at < CACHE_TTL_MS) {
          return parsed.snapshot;
        }
      }
    } catch {
      /* ignore */
    }
  }

  const cfg = getFirebaseConfig();
  const projectId = cfg?.projectId || 'unknown';
  const user = getCurrentUser();
  const local = getLocalFirestoreOpsToday();

  let firestoreBytes = 0;
  let syncDocs = 0;
  let firestoreNote =
    'Firestore stores inventory JSON only (photos are not counted here — see Storage below).';

  if (user) {
    const packs = await sumCollectionDocBytes(['users', user.uid, 'syncPack']);
    firestoreBytes += packs.bytes;
    syncDocs += packs.docs;

    try {
      const cards = await sumCollectionDocBytes(['users', user.uid, 'productCardGallery']);
      firestoreBytes += cards.bytes;
      syncDocs += cards.docs;
    } catch {
      /* optional collection */
    }

    try {
      const orders = await sumCollectionDocBytes(['users', user.uid, 'ebayOrders']);
      firestoreBytes += orders.bytes;
      syncDocs += orders.docs;
    } catch {
      /* optional */
    }
  } else {
    firestoreNote = 'Sign in to measure your Firestore documents.';
  }

  let storageBytes = 0;
  let storageFiles = 0;
  let storageNote = 'Firebase Storage Spark free tier (5 GB) — this is where item photos live.';

  if (includeStorage && user) {
    const ctx = getFirebaseContext();
    if (ctx?.storage) {
      const prefixes = [
        `items/${user.uid}`,
        `product-cards/${user.uid}`,
        `expenses/${user.uid}`,
      ];
      let listedBytes = 0;
      let listedFiles = 0;
      let truncated = false;
      for (const p of prefixes) {
        const part = await sumStoragePrefixBytes(ctx.storage, p);
        listedBytes += part.bytes;
        listedFiles += part.files;
        if (part.truncated) truncated = true;
      }

      const urls = collectStorageUrlsFromItems(items);
      let urlBytes = 0;
      let urlSized = 0;
      if (urls.length) {
        const fromUrls = await sumStorageUrlBytes(ctx.storage, urls);
        urlBytes = fromUrls.bytes;
        urlSized = fromUrls.sized;
        // If metadata failed for some URLs, pad with average compressed size
        if (fromUrls.sized < fromUrls.files) {
          urlBytes += (fromUrls.files - fromUrls.sized) * AVG_COMPRESSED_IMAGE_BYTES;
        }
      }

      // Prefer the larger of folder-list vs inventory-URL scan (list can miss files; URLs miss orphans)
      if (listedBytes >= urlBytes && listedFiles > 0) {
        storageBytes = listedBytes;
        storageFiles = listedFiles;
        storageNote = truncated
          ? `Storage scan capped · ${listedFiles} files (photos live here, not in Firestore).`
          : `Storage · ${listedFiles} file${listedFiles === 1 ? '' : 's'} (photos live here, not in the 1 GiB Firestore quota).`;
      } else if (urls.length > 0) {
        storageBytes = urlBytes;
        storageFiles = urls.length;
        storageNote =
          urlSized > 0
            ? `Storage · ${urls.length} image URL${urls.length === 1 ? '' : 's'} from inventory (${urlSized} sized via metadata).`
            : `Storage · ~${urls.length} inventory images (estimated ~${Math.round(AVG_COMPRESSED_IMAGE_BYTES / 1024)} KB each).`;
      } else if (listedFiles > 0) {
        storageBytes = listedBytes;
        storageFiles = listedFiles;
        storageNote = `Storage · ${listedFiles} files scanned.`;
      } else {
        storageNote =
          'No Storage files found yet. Photos upload to Firebase Storage (5 GB free), separate from Firestore docs.';
      }
    }
  }

  const monitoring = includeMonitoring ? await fetchMonitoringQuota() : null;

  const snapshot = buildQuotaSnapshot({
    projectId,
    firestoreStoredBytes: firestoreBytes,
    firestoreSyncDocs: syncDocs,
    storageStoredBytes: storageBytes,
    storageFiles,
    localReads: local.reads,
    localWrites: local.writes,
    localDeletes: local.deletes,
    monitoring,
    firestoreNote,
    storageNote,
  });

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), snapshot }));
  } catch {
    /* ignore */
  }

  return snapshot;
}
