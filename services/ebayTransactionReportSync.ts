import {
  fetchEbayTxReportRowsFromCloud,
  fetchEbayTxReportsFromCloud,
  isCloudEnabled,
  waitForAuthReady,
  writeEbayTxReportRowsToCloud,
  writeEbayTxReportsToCloud,
  type EbayTxCloudState,
} from './firebaseService';
import {
  clearEbayTransactionReport,
  loadEbayTransactionLibrary,
  loadEbayTxCloudStats,
  loadEbayTxLabelOverrides,
  saveEbayTransactionLibrary,
  saveEbayTxCloudStats,
  saveEbayTxLabelOverrides,
  type EbayTxCloudStats,
  type EbayTxLabelOverride,
  type EbayTxLibrary,
} from './ebayTransactionReportStore';
import {
  getOrderMatcherNeedsReviewMap,
  mergeOrderMatcherNeedsReviewMap,
  type NeedsReviewEntry,
} from '../utils/orderMatcherNeedsReview';

/** Local marker so an intentional Clear is not immediately refilled from stale cloud. */
const EBAY_TX_CLEARED_AT_KEY = 'ebay_tx_reports_cleared_at';

export function readEbayTxClearedAt(): string {
  try {
    return localStorage.getItem(EBAY_TX_CLEARED_AT_KEY) || '';
  } catch {
    return '';
  }
}

export function markEbayTxCleared(at = new Date().toISOString()): void {
  try {
    localStorage.setItem(EBAY_TX_CLEARED_AT_KEY, at);
  } catch {
    /* ignore */
  }
}

export function clearEbayTxClearedMarker(): void {
  try {
    localStorage.removeItem(EBAY_TX_CLEARED_AT_KEY);
  } catch {
    /* ignore */
  }
}
import {
  applyEbayTxLabelOverrides,
  buildEbayTxOrderLedgers,
  ebayTxImportedCoverage,
  mergeEbayTxReports,
  summarizeEbayTxOrderLedgers,
  type EbayTxMeta,
  type EbayTxReport,
  type EbayTxRow,
  type EbayTxSummary,
} from '../utils/ebayTransactionReport';

export const EBAY_TX_REPORT_UPDATED_EVENT = 'ebay-tx-report-updated';

export function notifyEbayTxReportUpdated() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EBAY_TX_REPORT_UPDATED_EVENT));
  void import('./ebayTxDailyExport')
    .then((mod) => mod.scheduleEbayTxDailyCsvExport({ force: true }))
    .catch(() => undefined);
}

function stripRows(report: EbayTxReport): { meta: EbayTxMeta; summary: EbayTxSummary } {
  return { meta: report.meta, summary: report.summary };
}

export async function buildEbayTxCloudStateFromLocal(): Promise<EbayTxCloudState> {
  const library = await loadEbayTransactionLibrary();
  const labelOverrides = await loadEbayTxLabelOverrides();
  const stats = await loadEbayTxCloudStats();
  const merged = mergeEbayTxReports(library.reports);
  let pocket = stats?.pocket || null;
  let combinedSummary = stats?.combinedSummary || merged?.summary || null;
  if (merged?.rows?.length) {
    const ledgers = applyEbayTxLabelOverrides(buildEbayTxOrderLedgers(merged.rows), labelOverrides);
    pocket = summarizeEbayTxOrderLedgers(ledgers);
    combinedSummary = merged.summary;
  }
  return {
    reports: library.reports.map(stripRows),
    labelOverrides,
    needsReview: getOrderMatcherNeedsReviewMap(),
    coverage: ebayTxImportedCoverage(library.reports),
    pocket,
    combinedSummary,
    updatedAt: new Date().toISOString(),
  };
}

export async function persistEbayTxCloudStats(state: EbayTxCloudState): Promise<void> {
  await saveEbayTxCloudStats({
    coverage: state.coverage as EbayTxCloudStats['coverage'],
    pocket: state.pocket as EbayTxCloudStats['pocket'],
    combinedSummary: state.combinedSummary,
    updatedAt: state.updatedAt,
  });
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleEbayTxReportsCloudPush() {
  if (!isCloudEnabled()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    void pushEbayTxReportsToCloud().catch((err) => console.warn('eBay Abrechnung cloud push failed:', err));
  }, 1500);
}

export async function pushEbayTxReportsToCloud(): Promise<void> {
  if (!isCloudEnabled()) return;
  const state = await buildEbayTxCloudStateFromLocal();
  await persistEbayTxCloudStats(state);
  try {
    // Actual row data, previously never synced at all — only meta/summary were. This is
    // the piece that let a device's local storage getting cleared silently lose real data.
    const library = await loadEbayTransactionLibrary();
    const rowsByReport: Record<string, unknown[]> = {};
    for (const r of library.reports) rowsByReport[r.meta.id] = r.rows || [];
    const { rowChunks } = await writeEbayTxReportRowsToCloud(rowsByReport);
    await writeEbayTxReportsToCloud({ ...state, rowChunks });
  } catch (err) {
    if (err instanceof Error && err.message === 'Not signed in') return;
    throw err;
  }
}

/** Wipe IndexedDB + cloud Abrechnung so Clear is not undone by the next cloud pull. */
export async function clearEbayTransactionReportsEverywhere(): Promise<void> {
  const clearedAt = new Date().toISOString();
  markEbayTxCleared(clearedAt);
  await clearEbayTransactionReport();
  const empty: EbayTxCloudState = {
    reports: [],
    labelOverrides: {},
    coverage: null,
    pocket: null,
    combinedSummary: null,
    updatedAt: clearedAt,
  };
  await persistEbayTxCloudStats(empty);
  if (isCloudEnabled()) {
    try {
      await writeEbayTxReportsToCloud(empty);
    } catch (err) {
      if (!(err instanceof Error && err.message === 'Not signed in')) {
        console.warn('eBay Abrechnung cloud clear failed:', err);
      }
    }
  }
  notifyEbayTxReportUpdated();
}

function asReport(raw: { meta?: EbayTxMeta; summary?: EbayTxSummary }): EbayTxReport | null {
  if (!raw?.meta?.id || !raw.summary) return null;
  return { meta: raw.meta, summary: raw.summary, rows: [] };
}

function mergeLabelOverrides(
  local: Record<string, EbayTxLabelOverride>,
  remote: Record<string, EbayTxLabelOverride>
): Record<string, EbayTxLabelOverride> {
  const next = { ...local };
  for (const [orderId, override] of Object.entries(remote || {})) {
    const cur = next[orderId];
    if (!cur || (override.updatedAt || '') >= (cur.updatedAt || '')) next[orderId] = override;
  }
  return next;
}

export async function applyEbayTxCloudState(remote: EbayTxCloudState, keepLocalRows = true): Promise<void> {
  const local = await loadEbayTransactionLibrary();
  const remoteHasReports = (remote.reports || []).length > 0;
  const localHasRows = local.reports.some((r) => r.rows?.length);
  // A failed IndexedDB read returns []. Local is genuinely empty (fresh device, or storage
  // just got cleared) — pull the real row data down from its shards instead of leaving this
  // device with only summary stats and an empty order table (the bug that caused a device to
  // look like it had "lost" 500+ linked orders when it never actually had cloud rows to lose).
  if (keepLocalRows && !local.reports.length && remoteHasReports) {
    const flatRows = await fetchEbayTxReportRowsFromCloud(remote.rowChunks || 0);
    if (flatRows.length) {
      const byReport = new Map<string, EbayTxRow[]>();
      for (const { rid, row } of flatRows) {
        const list = byReport.get(rid) || [];
        list.push(row as EbayTxRow);
        byReport.set(rid, list);
      }
      const reports = (remote.reports || [])
        .map((raw) => asReport(raw as { meta?: EbayTxMeta; summary?: EbayTxSummary }))
        .filter((r): r is EbayTxReport => Boolean(r))
        .map((r) => ({ ...r, rows: byReport.get(r.meta.id) || [] }));
      if (reports.length) await saveEbayTransactionLibrary({ reports });
    }
    mergeOrderMatcherNeedsReviewMap((remote.needsReview || {}) as Record<string, NeedsReviewEntry>);
    await persistEbayTxCloudStats(remote);
    notifyEbayTxReportUpdated();
    return;
  }
  const localById = new Map(local.reports.map((r) => [r.meta.id, r]));
  const reports: EbayTxReport[] = [];
  for (const raw of remote.reports || []) {
    const cloud = asReport(raw as { meta?: EbayTxMeta; summary?: EbayTxSummary });
    if (!cloud) continue;
    const existing = localById.get(cloud.meta.id);
    if (keepLocalRows && existing?.rows?.length) {
      reports.push({ ...existing, meta: cloud.meta, summary: cloud.summary });
    } else {
      reports.push(cloud);
    }
    localById.delete(cloud.meta.id);
  }
  if (keepLocalRows && remoteHasReports) {
    for (const leftover of localById.values()) reports.push(leftover);
  }
  reports.sort((a, b) => (a.meta.id || '').localeCompare(b.meta.id || ''));
  const sameIds =
    reports.length === local.reports.length &&
    reports.every((r, i) => r.meta.id === local.reports[i]?.meta.id);
  if (!(keepLocalRows && localHasRows && sameIds)) {
    await saveEbayTransactionLibrary({ reports });
  }
  const localLabels = await loadEbayTxLabelOverrides();
  await saveEbayTxLabelOverrides(
    mergeLabelOverrides(localLabels, (remote.labelOverrides || {}) as Record<string, EbayTxLabelOverride>)
  );
  mergeOrderMatcherNeedsReviewMap((remote.needsReview || {}) as Record<string, NeedsReviewEntry>);
  await persistEbayTxCloudStats(remote);
  notifyEbayTxReportUpdated();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function syncEbayTxReportsWithCloud(): Promise<void> {
  if (!isCloudEnabled()) return;
  const localLib = await loadEbayTransactionLibrary();
  const localStats = await loadEbayTxCloudStats();
  const localLabels = await loadEbayTxLabelOverrides();
  const localHas = localLib.reports.length > 0 || Object.keys(localLabels).length > 0;
  let remote = await fetchEbayTxReportsFromCloud();
  // fetchEbayTxReportsFromCloud() returns null both when the cloud genuinely has nothing
  // AND when the read itself failed (auth token not fully warmed up right after a fresh
  // sign-in, a cold Firestore connection, a transient network blip) — those two cases are
  // indistinguishable from here, but only one of them is safe to treat as final. This
  // wrapper is memoized per page load (see runEbayTxCloudSyncOnce below), so getting this
  // wrong on the first try meant a device could show a permanently empty Abrechnung page
  // for the rest of that session even though its real order history was sitting untouched
  // in the cloud the whole time. When local is also empty, retry a couple of times before
  // accepting "empty" — a device that actually has cloud data almost always succeeds on
  // the second or third try; a device that's genuinely new stays empty either way.
  if (!remote && !localHas) {
    for (const backoffMs of [800, 1600]) {
      await delay(backoffMs);
      remote = await fetchEbayTxReportsFromCloud();
      if (remote) break;
    }
  }
  const clearedAt = readEbayTxClearedAt();
  if (!remote) {
    if (localHas) await pushEbayTxReportsToCloud();
    return;
  }
  const remoteHas = (remote.reports || []).length > 0 || Object.keys(remote.labelOverrides || {}).length > 0;
  const remoteTs = remote.updatedAt || '';

  // User cleared Abrechnung: keep empty until a newer cloud write (re-import on another device).
  if (!localHas && clearedAt) {
    if (!remoteHas || remoteTs <= clearedAt) {
      if (remoteHas) await pushEbayTxReportsToCloud();
      return;
    }
    clearEbayTxClearedMarker();
    // keepLocalRows=true here isn't about preserving anything local (there's nothing to keep —
    // !localHas guarantees local.reports is empty) — it's what actually gates the shard-row
    // fetch inside applyEbayTxCloudState. Passing false skipped that fetch entirely and saved
    // summary-only report shells with empty rows, which made a brand-new device's own coverage
    // check see zero covered orders and treat the whole order history as "new" — this is very
    // likely what actually caused a first-time phone login to duplicate orders, independent of
    // the runEbayTxCloudSyncOnce timing fix above.
    await applyEbayTxCloudState(remote, true);
    return;
  }

  if (!localHas) {
    await applyEbayTxCloudState(remote, true);
    return;
  }
  const localTs = localStats?.updatedAt || '';
  if (remoteTs > localTs) {
    await applyEbayTxCloudState(remote, true);
    const after = await loadEbayTransactionLibrary();
    if (after.reports.length > (remote.reports?.length || 0)) {
      await pushEbayTxReportsToCloud();
    }
    return;
  }
  if (localTs > remoteTs || localLib.reports.length > (remote.reports?.length || 0)) {
    await pushEbayTxReportsToCloud();
  }
}

let inFlightCloudSync: Promise<void> | null = null;

/**
 * Memoized wrapper around syncEbayTxReportsWithCloud() — the first caller (normally App.tsx,
 * on auth) kicks off the real Firestore pull; anyone else (the Abrechnung page's own auto-sync)
 * just awaits the same in-flight promise instead of racing it. That race was the actual cause
 * of orders doubling on a fresh device/browser: the page's own `loading` flag only reflects an
 * (empty, near-instant) local IndexedDB read, while this pull is deliberately deferred via
 * requestIdleCallback and can take seconds — plenty of time for the API auto-sync to run first,
 * see zero CSV-covered orders, and dump the entire order history in as "new".
 *
 * Also waits for Firebase's own auth-ready signal first (see waitForAuthReady) — the Abrechnung
 * page can call this before App.tsx's own authUser-gated effect ever runs, and
 * fetchEbayTxReportsFromCloud() reads auth.currentUser directly, which is still null during
 * that window even on a device that IS signed in. Without this wait, the very first call could
 * silently run against "not signed in yet", get treated as "no cloud data", and — being
 * memoized — never retry for the rest of the session.
 */
export function runEbayTxCloudSyncOnce(): Promise<void> {
  if (!inFlightCloudSync) {
    inFlightCloudSync = waitForAuthReady()
      .then(() => syncEbayTxReportsWithCloud())
      .catch((e) => {
        console.warn('eBay Abrechnung cloud sync failed:', e);
      });
  }
  return inFlightCloudSync;
}

export type { EbayTxCloudStats, EbayTxLibrary };
