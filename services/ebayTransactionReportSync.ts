import {
  clearEbayTxReportsCloud,
  fetchEbayTxReportRowsFromCloud,
  fetchEbayTxReportsFromCloud,
  isCloudEnabled,
  upsertEbayOrdersToCloud,
  waitForAuthReady,
  writeEbayTxReportRowsToCloud,
  writeEbayTxReportsToCloud,
  type EbayTxCloudState,
} from './supabaseService';
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

/**
 * Short enough to feel immediate, long enough that a burst of rapid actions
 * (linking twenty orders in a row) still collapses into one Supabase write
 * instead of twenty racing ones.
 */
export const EBAY_TX_PUSH_DEBOUNCE_MS = 300;

export type EbayTxPushStatus =
  | { state: 'idle' }
  | { state: 'pushing' }
  | { state: 'ok'; at: string }
  | { state: 'error'; at: string; message: string };

let lastPushStatus: EbayTxPushStatus = { state: 'idle' };

export const EBAY_TX_PUSH_STATUS_EVENT = 'ebay-tx-push-status';

export function getEbayTxPushStatus(): EbayTxPushStatus {
  return lastPushStatus;
}

function setPushStatus(next: EbayTxPushStatus): void {
  lastPushStatus = next;
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EBAY_TX_PUSH_STATUS_EVENT, { detail: next }));
}

export function scheduleEbayTxReportsCloudPush() {
  if (!isCloudEnabled()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushEbayTxReportsToCloud().catch(() => undefined);
  }, EBAY_TX_PUSH_DEBOUNCE_MS);
}

/**
 * Push right now and wait for Supabase to confirm, cancelling any pending
 * debounced push. Use for actions that must be durable before the page can be
 * reloaded — above all the one-time CSV baseline import: Supabase is the source
 * of truth, so an imported report that only exists in IndexedDB would be wiped
 * by the next authoritative pull rather than saved.
 */
export async function flushEbayTxReportsCloudPush(): Promise<EbayTxPushStatus> {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  if (!isCloudEnabled()) return getEbayTxPushStatus();
  await pushEbayTxReportsToCloud().catch(() => undefined);
  return getEbayTxPushStatus();
}

/** Supabase is the source of truth — a dropped write is real data loss, so retry before giving up. */
const PUSH_MAX_ATTEMPTS = 3;

export async function pushEbayTxReportsToCloud(): Promise<void> {
  if (!isCloudEnabled()) return;
  // Never upload local state before the initial cloud reconcile has finished.
  // On a device still holding a stale IndexedDB library (e.g. right after the
  // cloud side was intentionally wiped for a clean baseline), any UI action that
  // schedules a push could otherwise beat runEbayTxCloudSyncOnce() and re-upload
  // the entire stale library — silently undoing the wipe. Waiting here means a
  // push always runs against reconciled local state.
  await runEbayTxCloudSyncOnce();
  const state = await buildEbayTxCloudStateFromLocal();
  await persistEbayTxCloudStats(state);

  setPushStatus({ state: 'pushing' });
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= PUSH_MAX_ATTEMPTS; attempt++) {
    try {
      const library = await loadEbayTransactionLibrary();
      if (library.reports.length === 0) {
        setPushStatus({ state: 'ok', at: new Date().toISOString() });
        return;
      }

      await writeEbayTxReportsToCloud(library.reports);

      const merged = mergeEbayTxReports(library.reports);
      if (merged?.rows?.length) {
        const ledgers = buildEbayTxOrderLedgers(merged.rows);
        const orderRows = merged.rows.filter((r) => r.kind === 'order' && (r.orderId || '').trim());
        const orders = orderRows.map((row) => ({
          orderId: row.orderId.trim(),
          title: row.title || row.description,
          buyerUsername: row.buyerUsername,
          buyerName: row.buyerName,
          date: row.createdSort || row.createdAt,
          itemSubtotalEur: row.itemSubtotalEur,
          shippingEur: row.shippingEur,
          grossEur: row.grossEur,
          netEur: row.netEur,
          ledger: ledgers.get(row.orderId.trim()) || null,
          source: row.id.startsWith('api-') ? 'api' : 'csv',
        }));
        await upsertEbayOrdersToCloud(orders);
      }

      setPushStatus({ state: 'ok', at: new Date().toISOString() });
      return;
    } catch (err) {
      if (err instanceof Error && err.message === 'Not signed in') {
        setPushStatus({ state: 'idle' });
        return;
      }
      lastError = err;
      if (attempt < PUSH_MAX_ATTEMPTS) await delay(attempt * 600);
    }
  }

  const message = lastError instanceof Error ? lastError.message : 'Supabase write failed';
  console.error(`eBay Abrechnung cloud push failed after ${PUSH_MAX_ATTEMPTS} attempts:`, lastError);
  setPushStatus({ state: 'error', at: new Date().toISOString(), message });
  throw lastError instanceof Error ? lastError : new Error(message);
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
      // Must be a real DELETE on both ebay_tx_reports and ebay_orders.
      // writeEbayTxReportsToCloud() cannot clear anything: it early-returns on an
      // empty report list, so the previous call here was a silent no-op that left
      // every row in Supabase. Local was wiped, cloud was not — and the next
      // syncEbayTxReportsWithCloud() then pulled the whole stale library straight
      // back down, which is exactly what "Clear" is supposed to prevent.
      await clearEbayTxReportsCloud();
    } catch (err) {
      if (!(err instanceof Error && err.message === 'Not signed in')) {
        console.warn('eBay Abrechnung cloud clear failed:', err);
      }
    }
  }
  notifyEbayTxReportUpdated();
}

function asReport(raw: any): EbayTxReport | null {
  if (!raw?.meta?.id || !raw.summary) return null;
  return {
    meta: raw.meta,
    summary: raw.summary,
    rows: Array.isArray(raw.rows) ? raw.rows : [],
  };
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

  const localById = new Map(local.reports.map((r) => [r.meta.id, r]));
  const reports: EbayTxReport[] = [];
  for (const raw of remote.reports || []) {
    const cloud = asReport(raw);
    if (!cloud) continue;
    const existing = localById.get(cloud.meta.id);
    if (existing?.rows?.length && (!cloud.rows?.length || keepLocalRows)) {
      reports.push({ ...existing, meta: cloud.meta, summary: cloud.summary, rows: existing.rows });
    } else {
      reports.push(cloud);
    }
    localById.delete(cloud.meta.id);
  }
  if (keepLocalRows && remoteHasReports) {
    for (const leftover of localById.values()) reports.push(leftover);
  }
  reports.sort((a, b) => (a.meta.id || '').localeCompare(b.meta.id || ''));
  await saveEbayTransactionLibrary({ reports });

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
  const remote = await fetchEbayTxReportsFromCloud();
  // Fetch failed — never wipe local on ambiguous errors.
  if (remote === null) {
    console.warn('[ebay-cloud] Abrechnung pull failed — keeping local cache');
    return;
  }
  if (!remote.reports || remote.reports.length === 0) {
    // Confirmed empty cloud: only clear local when the user explicitly cleared Abrechnung.
    if (readEbayTxClearedAt()) {
      await clearEbayTransactionReport();
      notifyEbayTxReportUpdated();
    }
    return;
  }
  await applyEbayTxCloudState(remote, false);
}

let inFlightCloudHydration: Promise<void> | null = null;
let ebayCloudHydrated = false;

/** True after the first successful Supabase pull for eBay data this session. */
export function isEbayCloudHydrated(): boolean {
  return ebayCloudHydrated || !isCloudEnabled();
}

/**
 * Load eBay order index + Abrechnung reports from Supabase before any local mutations.
 * Memoized — every caller awaits the same in-flight pull.
 */
export async function ensureEbayCloudDataLoaded(): Promise<void> {
  if (!isCloudEnabled()) return;
  if (ebayCloudHydrated) return;
  if (!inFlightCloudHydration) {
    inFlightCloudHydration = (async () => {
      const authed = await waitForAuthReady();
      if (!authed) {
        console.warn('[ebay-cloud] Auth not ready — skipping cloud hydrate (local cache kept)');
        return;
      }
      const { pullOrderIndexFromCloud } = await import('./ebayOrderIndex');
      await pullOrderIndexFromCloud();
      await syncEbayTxReportsWithCloud();
      ebayCloudHydrated = true;
    })()
      .catch((e) => {
        console.warn('eBay cloud hydrate failed:', e);
      })
      .finally(() => {
        inFlightCloudHydration = null;
      });
  }
  await inFlightCloudHydration;
}

/** Memoized Supabase-first hydrate — safe to await from App, Abrechnung, and push paths. */
export function runEbayTxCloudSyncOnce(): Promise<void> {
  return ensureEbayCloudDataLoaded();
}

export type { EbayTxCloudStats, EbayTxLibrary };
