import type { EbayTxReport } from '../utils/ebayTransactionReport';

const DB_NAME = 'inventory-pro-ebay-tx-report';
const STORE = 'report';
const KEY_LIBRARY = 'library';
const KEY_LEGACY = 'latest';
const KEY_LABELS = 'labelOverrides';
const KEY_STATS = 'stats';

export type EbayTxCloudStats = {
  coverage: {
    from: string;
    to: string;
    nextExportStart: string;
    reportCount: number;
  } | null;
  pocket: {
    orderCount: number;
    pocketEur: number;
    adsEur: number;
    labelsEur: number;
    fvfEur: number;
    otherEur: number;
    grossEur: number;
  } | null;
  combinedSummary: Record<string, unknown> | null;
  updatedAt: string;
};

export type EbayTxLabelOverride = {
  orderId: string;
  amountEur: number;
  name?: string;
  updatedAt: string;
};

export type EbayTxLibrary = {
  reports: EbayTxReport[];
};

function ensureStore(db: IDBDatabase) {
  if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const openAt = (version?: number) => {
      const req = version == null ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, version);
      req.onupgradeneeded = () => ensureStore(req.result);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        if (db.objectStoreNames.contains(STORE)) {
          resolve(db);
          return;
        }
        const nextVersion = Math.max(db.version, 1) + 1;
        db.close();
        openAt(nextVersion);
      };
    };
    openAt();
  });
}

function withId(report: EbayTxReport): EbayTxReport {
  if (report.meta.id) return report;
  return {
    ...report,
    meta: {
      ...report.meta,
      id: `${report.meta.startDate || ''}_${report.meta.endDate || report.meta.fileName || 'legacy'}`,
    },
  };
}

export async function loadEbayTransactionLibrary(): Promise<EbayTxLibrary> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    const library = await new Promise<EbayTxLibrary | EbayTxReport | null>((resolve, reject) => {
      const tx = db!.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const req = store.get(KEY_LIBRARY);
      req.onsuccess = () => {
        if (req.result) {
          resolve(req.result as EbayTxLibrary);
          return;
        }
        const legacy = store.get(KEY_LEGACY);
        legacy.onsuccess = () => resolve((legacy.result as EbayTxReport) || null);
        legacy.onerror = () => reject(legacy.error);
      };
      req.onerror = () => reject(req.error);
    });
    if (!library) return { reports: [] };
    if (Array.isArray((library as EbayTxLibrary).reports)) {
      return { reports: (library as EbayTxLibrary).reports.map(withId) };
    }
    const legacy = library as EbayTxReport;
    if (legacy?.meta && (legacy.summary || Array.isArray(legacy.rows))) {
      return { reports: [withId(legacy)] };
    }
    return { reports: [] };
  } catch {
    return { reports: [] };
  } finally {
    db?.close();
  }
}

export async function saveEbayTransactionLibrary(library: EbayTxLibrary): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(library, KEY_LIBRARY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadEbayTxCloudStats(): Promise<EbayTxCloudStats | null> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    const stored = await new Promise<EbayTxCloudStats | null>((resolve, reject) => {
      const req = db!.transaction(STORE, 'readonly').objectStore(STORE).get(KEY_STATS);
      req.onsuccess = () => resolve((req.result as EbayTxCloudStats) || null);
      req.onerror = () => reject(req.error);
    });
    return stored && typeof stored === 'object' ? stored : null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

export async function saveEbayTxCloudStats(stats: EbayTxCloudStats): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(stats, KEY_STATS);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

function bumpCloudPush() {
  void import('./ebayTransactionReportSync')
    .then((mod) => mod.scheduleEbayTxReportsCloudPush())
    .catch(() => undefined);
}

export async function upsertEbayTransactionReport(report: EbayTxReport): Promise<EbayTxLibrary> {
  const { clearEbayTxClearedMarker } = await import('./ebayTransactionReportSync');
  clearEbayTxClearedMarker();
  const current = await loadEbayTransactionLibrary();
  const next = withId(report);
  const reports = [...current.reports.filter((r) => r.meta.id !== next.meta.id), next].sort((a, b) =>
    (a.meta.id || '').localeCompare(b.meta.id || '')
  );
  const library = { reports };
  await saveEbayTransactionLibrary(library);
  void import('./ebayTransactionReportSync')
    .then((mod) => mod.clearEbayTxClearedMarker())
    .catch(() => undefined);
  bumpCloudPush();
  return library;
}

export async function removeEbayTransactionReport(id: string): Promise<EbayTxLibrary> {
  const current = await loadEbayTransactionLibrary();
  const library = { reports: current.reports.filter((r) => r.meta.id !== id) };
  await saveEbayTransactionLibrary(library);
  bumpCloudPush();
  return library;
}

export async function loadEbayTxLabelOverrides(): Promise<Record<string, EbayTxLabelOverride>> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    const stored = await new Promise<Record<string, EbayTxLabelOverride> | null>((resolve, reject) => {
      const req = db!.transaction(STORE, 'readonly').objectStore(STORE).get(KEY_LABELS);
      req.onsuccess = () => resolve((req.result as Record<string, EbayTxLabelOverride>) || null);
      req.onerror = () => reject(req.error);
    });
    return stored && typeof stored === 'object' ? stored : {};
  } catch {
    return {};
  } finally {
    db?.close();
  }
}

export async function saveEbayTxLabelOverrides(overrides: Record<string, EbayTxLabelOverride>): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(overrides, KEY_LABELS);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function upsertEbayTxLabelOverride(
  orderId: string,
  amountEur: number,
  name?: string
): Promise<Record<string, EbayTxLabelOverride>> {
  const current = await loadEbayTxLabelOverrides();
  const next = {
    ...current,
    [orderId]: { orderId, amountEur, name, updatedAt: new Date().toISOString() },
  };
  await saveEbayTxLabelOverrides(next);
  bumpCloudPush();
  return next;
}

export async function removeEbayTxLabelOverride(orderId: string): Promise<Record<string, EbayTxLabelOverride>> {
  const current = await loadEbayTxLabelOverrides();
  const next = { ...current };
  delete next[orderId];
  await saveEbayTxLabelOverrides(next);
  bumpCloudPush();
  return next;
}

export async function clearEbayTransactionReport(): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY_LIBRARY);
      tx.objectStore(STORE).delete(KEY_LEGACY);
      tx.objectStore(STORE).delete(KEY_STATS);
      tx.objectStore(STORE).delete(KEY_LABELS);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
  // Do not schedule cloud push here — clearEbayTransactionReportsEverywhere writes empty state first.
}

/** @deprecated Use loadEbayTransactionLibrary */
export async function loadEbayTransactionReport(): Promise<EbayTxReport | null> {
  const { reports } = await loadEbayTransactionLibrary();
  return reports[0] || null;
}

/** @deprecated Use upsertEbayTransactionReport */
export async function saveEbayTransactionReport(report: EbayTxReport): Promise<void> {
  await upsertEbayTransactionReport(report);
}
