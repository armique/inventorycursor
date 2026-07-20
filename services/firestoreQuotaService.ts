/**
 * Measure / track Firestore + Storage usage against Spark free quotas.
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

const CACHE_KEY = 'deinv_firestore_quota_cache_v1';
const CACHE_TTL_MS = 5 * 60 * 1000;

function jsonByteSize(obj: unknown): number {
  try {
    return new Blob([JSON.stringify(obj)]).size;
  } catch {
    return 0;
  }
}

async function sumCollectionDocBytes(
  pathSegments: string[]
): Promise<{ bytes: number; docs: number }> {
  const ctx = getFirebaseContext();
  if (!ctx?.db || pathSegments.length < 1) return { bytes: 0, docs: 0 };
  // Firestore collection() needs alternating collection/doc segments ending on a collection.
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
  maxFiles = 800
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
}): Promise<FirestoreFreeQuotaSnapshot> {
  const force = options?.force === true;
  const includeStorage = options?.includeStorage !== false;
  const includeMonitoring = options?.includeMonitoring !== false;

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
  let firestoreNote = 'Estimated from your synced documents (indexes add a bit more).';

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
  let storageNote = 'Firebase Storage Spark free tier (5 GB).';

  if (includeStorage && user) {
    const ctx = getFirebaseContext();
    if (ctx?.storage) {
      const prefixes = [
        `items/${user.uid}`,
        `product-cards/${user.uid}`,
        `expenses/${user.uid}`,
      ];
      let truncated = false;
      for (const p of prefixes) {
        const part = await sumStoragePrefixBytes(ctx.storage, p);
        storageBytes += part.bytes;
        storageFiles += part.files;
        if (part.truncated) truncated = true;
      }
      if (truncated) {
        storageNote = 'Partial file scan (capped). Actual Storage usage may be higher.';
      } else {
        storageNote = `Scanned ${storageFiles} file${storageFiles === 1 ? '' : 's'} under your account.`;
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
