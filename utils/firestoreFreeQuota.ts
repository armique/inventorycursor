/**
 * Firestore / Firebase Storage Spark (free) quota constants + parsers.
 * Daily ops reset around midnight Pacific Time.
 */

export const FIRESTORE_FREE = {
  storedBytes: 1 * 1024 * 1024 * 1024, // 1 GiB
  readsPerDay: 50_000,
  writesPerDay: 20_000,
  deletesPerDay: 20_000,
  egressBytesPerMonth: 10 * 1024 * 1024 * 1024, // 10 GiB
} as const;

export const STORAGE_FREE = {
  storedBytes: 5 * 1024 * 1024 * 1024, // 5 GB
  downloadBytesPerDay: 1 * 1024 * 1024 * 1024, // 1 GB/day
  uploadOpsPerDay: 20_000,
  downloadOpsPerDay: 50_000,
} as const;

export type QuotaMeter = {
  used: number;
  limit: number;
  remaining: number;
  pctUsed: number;
  pctFree: number;
};

export type FirestoreFreeQuotaSnapshot = {
  /** ISO time this snapshot was built */
  at: string;
  /** Pacific calendar day key used for daily meters */
  pacificDay: string;
  projectId: string;
  source: 'estimated' | 'monitoring' | 'mixed';
  firestore: {
    stored: QuotaMeter;
    readsToday: QuotaMeter;
    writesToday: QuotaMeter;
    deletesToday: QuotaMeter;
    syncDocs?: number;
    note?: string;
  };
  storage: {
    stored: QuotaMeter;
    files?: number;
    note?: string;
  };
  monitoring?: {
    available: boolean;
    readsToday?: number;
    writesToday?: number;
    deletesToday?: number;
    error?: string;
  };
};

export function pacificDayKey(d = new Date()): string {
  // en-CA → YYYY-MM-DD in America/Los_Angeles
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function makeMeter(used: number, limit: number): QuotaMeter {
  const u = Math.max(0, Number.isFinite(used) ? used : 0);
  const lim = Math.max(1, limit);
  const remaining = Math.max(0, lim - u);
  const pctUsed = Math.min(100, (u / lim) * 100);
  return {
    used: u,
    limit: lim,
    remaining,
    pctUsed,
    pctFree: Math.max(0, 100 - pctUsed),
  };
}

export function formatBytes(bytes: number): string {
  const n = Math.max(0, bytes || 0);
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

export function formatOps(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

/** Parse a Cloud Monitoring timeSeries list into summed points. */
export function parseMonitoringTimeSeries(payload: unknown): number {
  if (!payload || typeof payload !== 'object') return 0;
  const series = (payload as { timeSeries?: unknown[] }).timeSeries;
  if (!Array.isArray(series)) return 0;
  let sum = 0;
  for (const s of series) {
    if (!s || typeof s !== 'object') continue;
    const points = (s as { points?: unknown[] }).points;
    if (!Array.isArray(points)) continue;
    for (const p of points) {
      if (!p || typeof p !== 'object') continue;
      const v = (p as { value?: { int64Value?: string | number; doubleValue?: number } }).value;
      if (!v) continue;
      if (v.int64Value != null) sum += Number(v.int64Value) || 0;
      else if (typeof v.doubleValue === 'number') sum += v.doubleValue;
    }
  }
  return sum;
}

export type MonitoringQuotaJson = {
  ok?: boolean;
  projectId?: string;
  pacificDay?: string;
  reads?: number;
  writes?: number;
  deletes?: number;
  error?: string;
  raw?: unknown;
};

/** Normalize `/api/firestore-quota` JSON into numeric daily ops. */
export function parseMonitoringQuotaResponse(json: unknown): MonitoringQuotaJson {
  if (!json || typeof json !== 'object') {
    return { ok: false, error: 'Empty response' };
  }
  const o = json as Record<string, unknown>;
  if (o.error && !o.ok) {
    return {
      ok: false,
      projectId: typeof o.projectId === 'string' ? o.projectId : undefined,
      error: String(o.error),
    };
  }
  const reads =
    typeof o.reads === 'number'
      ? o.reads
      : parseMonitoringTimeSeries(o.readsSeries ?? o.rawReads);
  const writes =
    typeof o.writes === 'number'
      ? o.writes
      : parseMonitoringTimeSeries(o.writesSeries ?? o.rawWrites);
  const deletes =
    typeof o.deletes === 'number'
      ? o.deletes
      : parseMonitoringTimeSeries(o.deletesSeries ?? o.rawDeletes);

  return {
    ok: o.ok !== false,
    projectId: typeof o.projectId === 'string' ? o.projectId : undefined,
    pacificDay: typeof o.pacificDay === 'string' ? o.pacificDay : undefined,
    reads,
    writes,
    deletes,
    error: typeof o.error === 'string' ? o.error : undefined,
  };
}

export function buildQuotaSnapshot(input: {
  projectId: string;
  firestoreStoredBytes: number;
  firestoreSyncDocs?: number;
  storageStoredBytes: number;
  storageFiles?: number;
  localReads: number;
  localWrites: number;
  localDeletes: number;
  monitoring?: MonitoringQuotaJson | null;
  firestoreNote?: string;
  storageNote?: string;
}): FirestoreFreeQuotaSnapshot {
  const day = pacificDayKey();
  const mon = input.monitoring;
  const useMon = !!(mon && mon.ok && (mon.reads != null || mon.writes != null));

  const readsUsed = useMon && mon?.reads != null ? mon.reads : input.localReads;
  const writesUsed = useMon && mon?.writes != null ? mon.writes : input.localWrites;
  const deletesUsed = useMon && mon?.deletes != null ? mon.deletes : input.localDeletes;

  let source: FirestoreFreeQuotaSnapshot['source'] = 'estimated';
  if (useMon) source = input.localReads || input.localWrites ? 'mixed' : 'monitoring';

  return {
    at: new Date().toISOString(),
    pacificDay: day,
    projectId: input.projectId,
    source,
    firestore: {
      stored: makeMeter(input.firestoreStoredBytes, FIRESTORE_FREE.storedBytes),
      readsToday: makeMeter(readsUsed, FIRESTORE_FREE.readsPerDay),
      writesToday: makeMeter(writesUsed, FIRESTORE_FREE.writesPerDay),
      deletesToday: makeMeter(deletesUsed, FIRESTORE_FREE.deletesPerDay),
      syncDocs: input.firestoreSyncDocs,
      note: input.firestoreNote,
    },
    storage: {
      stored: makeMeter(input.storageStoredBytes, STORAGE_FREE.storedBytes),
      files: input.storageFiles,
      note: input.storageNote,
    },
    monitoring: {
      available: useMon,
      readsToday: mon?.reads,
      writesToday: mon?.writes,
      deletesToday: mon?.deletes,
      error: mon?.error,
    },
  };
}
