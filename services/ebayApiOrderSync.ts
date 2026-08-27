/**
 * Replaces the old CDP/Playwright "Hub sync" (which required a manually-launched, logged-in
 * Chrome window and only ever worked on this one Windows machine in local dev — see
 * services/ebayHubArchiveSync.ts for the retired implementation). This uses the eBay REST API
 * (OAuth, already wired up for Listings sync / order backfill elsewhere in the app) instead of
 * scraping a live browser session, so it works the same way in local dev and on the deployed
 * site, with no separate Chrome window to babysit.
 *
 * On every app visit: pull recent orders via the OAuth Fulfillment API, then rebuild a single
 * "eBay API sync" report from every API-known order that isn't already covered by a CSV import,
 * and upsert it into the same Abrechnung report library the CSV importer writes to. New orders
 * show up there as ordinary Bestellung rows, ready to be linked to inventory like any other row —
 * nothing else in the Abrechnung UI needs to know where a row came from.
 */
import { getEbayConnectionStatus } from './ebayService';
import { refreshRecentEbayOrders } from './ebayOrderBackfill';
import { backfillEbayFinances } from './ebayFinancesBackfill';
import { loadEbayOrderIndex, type EbayOrderRecord } from './ebayOrderIndex';
import {
  loadEbayTransactionLibrary,
  upsertEbayTransactionReport,
} from './ebayTransactionReportStore';
import { notifyEbayTxReportUpdated } from './ebayTransactionReportSync';
import { summarizeEbayTxRows, type EbayTxReport, type EbayTxRow } from '../utils/ebayTransactionReport';
import { roundMoney } from './financialAggregation';

/** Fixed report id — each sync rebuilds and replaces this one slot, never appends a new report. */
const API_SYNC_REPORT_ID = 'api-sync';

/** How far back to check on a routine app-visit sync — cheap, and covers anything missed by a prior run. */
const APP_VISIT_LOOKBACK_DAYS = 30;

let appVisitSyncRan = false;

export function resetApiOrderSyncForRetry(): void {
  appVisitSyncRan = false;
}

/** Base fields shared by every row synthesized for one order — callers override per-kind fields. */
function baseTxRow(order: EbayOrderRecord, day: string): EbayTxRow {
  const lineItems = order.lineItems || [];
  return {
    id: `api-${order.orderId}`,
    createdAt: day,
    createdSort: day,
    typeRaw: 'Bestellung',
    kind: 'order',
    orderId: order.orderId,
    buyerUsername: order.buyer?.username || '',
    buyerName: order.buyer?.fullName || '',
    city: '',
    zip: '',
    country: '',
    netEur: null,
    payoutDate: '',
    payoutId: '',
    payoutMethod: '',
    payoutStatus: '',
    listingId: lineItems[0]?.listingId || '',
    transactionId: '',
    title: '',
    sku: lineItems[0]?.sku || '',
    quantity: null,
    itemSubtotalEur: null,
    shippingEur: null,
    sellerTaxEur: null,
    ebayTaxEur: order.taxTotal ?? null,
    fixedFeeEur: null,
    variableFeeEur: null,
    otherOrderFeeEur: null,
    grossEur: null,
    currency: 'EUR',
    reference: '',
    description: '',
  };
}

/**
 * Turn one order into the EbayTxRow(s) the Abrechnung ledger expects — one 'order' row plus, when
 * the eBay Sell Finances API has already reported fees for this order (order.financialEvents),
 * one extra 'label'/'other_fee' row per fee bucket, exactly mirroring how a CSV import splits
 * Versandetikett/Anzeigengebühr/Transaktionsgebühren onto separate rows for the same order.
 */
function orderRecordToTxRows(order: EbayOrderRecord): EbayTxRow[] {
  const lineItems = order.lineItems || [];
  const title = lineItems.map((li) => li.title).filter(Boolean).join(' + ') || '';
  const lineItemSubtotal = lineItems.reduce((sum, li) => sum + (Number(li.lineItemCost) || 0), 0) || null;
  const quantity = lineItems.reduce((sum, li) => sum + (Number(li.quantity) || 0), 0) || null;
  const day = order.creationDate || '';

  const events = order.financialEvents || [];
  const feeEvents = events.filter((e) => e.kind === 'fee');
  const hasFinancesData = feeEvents.length > 0;

  if (!hasFinancesData) {
    // No Sell Finances data yet for this order (e.g. not paid out yet) — fall back to the
    // single lump-sum row so the order still shows up, just without the fee split.
    const row = baseTxRow(order, day);
    row.title = title;
    row.quantity = quantity;
    row.itemSubtotalEur = lineItemSubtotal ?? order.grossTotal ?? null;
    row.shippingEur = order.shippingCost ?? null;
    row.netEur = order.netTotal ?? null;
    row.variableFeeEur = order.feeTotal != null ? -Math.abs(order.feeTotal) : null;
    row.grossEur = order.grossTotal ?? null;
    return [row];
  }

  const saleGross = events
    .filter((e) => e.kind === 'sale')
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0) || order.grossTotal || 0;

  let fvfEur = 0;
  const extraRows: EbayTxRow[] = [];
  feeEvents.forEach((e, idx) => {
    const amt = -Math.abs(Number(e.amount) || 0);
    const bucket = e.transactionType || '';
    if (bucket === 'Transaktionsgebühren') {
      fvfEur = roundMoney(fvfEur + amt);
      return;
    }
    const isLabel = bucket === 'Versandetikett';
    const isAd = bucket === 'Anzeigengebühr Basis';
    const row = baseTxRow(order, e.date || day);
    row.id = `api-fee-${order.orderId}-${idx}`;
    row.typeRaw = isLabel ? 'Versandetikett' : isAd ? 'Anzeigengebühr' : bucket || 'Sonstige Gebühr';
    row.kind = isLabel ? 'label' : 'other_fee';
    row.netEur = amt;
    row.grossEur = amt;
    row.description = isAd ? (e.description || 'Anzeigengebühr Basis') : e.description || bucket || 'Gebühr';
    extraRows.push(row);
  });

  const otherEvents = events.filter((e) => e.kind === 'refund' || e.kind === 'cancellation');
  otherEvents.forEach((e, idx) => {
    const amt = Number(e.amount) || 0;
    if (Math.abs(amt) < 0.01) return;
    const row = baseTxRow(order, e.date || day);
    row.id = `api-adj-${order.orderId}-${idx}`;
    row.typeRaw = e.kind === 'refund' ? 'Erstattung' : 'Stornierung';
    row.kind = 'refund';
    row.netEur = amt;
    row.grossEur = amt;
    row.description = e.description || row.typeRaw;
    extraRows.push(row);
  });

  // The eBay order APIs never expose buyer-paid shipping as its own field — but Sell
  // Finances' "sale" event amount is the buyer's FULL payment (item + shipping combined),
  // while the Fulfillment API's line items are item price only. The gap between the two
  // is exactly what the buyer paid for shipping — no separate shipping API call needed.
  // Only trust it when it's a real, sane amount (not a rounding artifact or a case where
  // the item price alone already accounts for everything, e.g. free shipping).
  const impliedShipping =
    lineItemSubtotal != null && saleGross - lineItemSubtotal > 0.01
      ? roundMoney(saleGross - lineItemSubtotal)
      : lineItemSubtotal != null
        ? 0
        : null;

  const orderRow = baseTxRow(order, day);
  orderRow.title = title;
  orderRow.quantity = quantity;
  orderRow.itemSubtotalEur = lineItemSubtotal ?? saleGross;
  orderRow.shippingEur = order.shippingCost ?? impliedShipping;
  orderRow.grossEur = roundMoney(saleGross);
  orderRow.variableFeeEur = fvfEur || null;
  orderRow.netEur = roundMoney(saleGross + fvfEur);

  return [orderRow, ...extraRows];
}

/**
 * Rebuild the "eBay API sync" report from the current order-index cache, excluding any order
 * already present in a CSV-imported report (CSV wins once it exists, so the same order never
 * shows as two separate Bestellung rows).
 */
export async function rebuildApiSyncReport(): Promise<{ report: EbayTxReport; newOrderIds: string[] }> {
  const library = await loadEbayTransactionLibrary();
  const previousApiReport = library.reports.find((r) => r.meta.id === API_SYNC_REPORT_ID);
  const previousApiOrderIds = new Set(
    (previousApiReport?.rows || []).filter((r) => r.kind === 'order').map((r) => r.orderId)
  );

  const csvOrderIds = new Set<string>();
  for (const report of library.reports) {
    if (report.meta.id === API_SYNC_REPORT_ID) continue;
    for (const row of report.rows) {
      if (row.kind === 'order' && row.orderId) csvOrderIds.add(row.orderId);
    }
  }

  const orderIndex = loadEbayOrderIndex();
  const apiOrders = orderIndex.orders.filter(
    (o) => o.sources.includes('api') && o.orderId && !csvOrderIds.has(o.orderId)
  );

  const rows = apiOrders
    .flatMap(orderRecordToTxRows)
    .sort((a, b) => (b.createdSort || '').localeCompare(a.createdSort || ''));
  const days = rows.map((r) => r.createdSort).filter(Boolean).sort();

  const report: EbayTxReport = {
    meta: {
      id: API_SYNC_REPORT_ID,
      seller: '',
      startDate: days[0] || '',
      endDate: days[days.length - 1] || '',
      fileName: 'eBay API sync',
      importedAt: new Date().toISOString(),
    },
    rows,
    summary: summarizeEbayTxRows(rows),
  };

  const newOrderIds = apiOrders
    .map((o) => o.orderId)
    .filter((id) => id && !previousApiOrderIds.has(id));

  return { report, newOrderIds };
}

export type ApiOrderSyncOutcome =
  | { status: 'skipped'; reason: 'already_ran' | 'not_connected' }
  | { status: 'ok'; added: number; total: number; upToDate: boolean; feesWarning?: string }
  | { status: 'error'; error: string; hint?: string };

function isoDateDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().split('T')[0];
}

/** Run once per page load when the panel opens — pulls recent orders, then rebuilds the API sync report. */
export async function syncNewEbayOrdersOnAppVisit(options?: { force?: boolean }): Promise<ApiOrderSyncOutcome> {
  if (appVisitSyncRan && !options?.force) {
    return { status: 'skipped', reason: 'already_ran' };
  }

  const status = getEbayConnectionStatus();
  if (!status.connected) {
    return { status: 'skipped', reason: 'not_connected' };
  }

  appVisitSyncRan = true;

  try {
    const refresh = await refreshRecentEbayOrders(APP_VISIT_LOOKBACK_DAYS);
    if (refresh.error) {
      appVisitSyncRan = false;
      return {
        status: 'error',
        error: refresh.error,
        hint: 'Reconnect eBay in Settings → Listings sync if this keeps failing.',
      };
    }

    // Fulfillment API has no fee breakdown — pull Sell Finances for the same window so orders
    // get the same FVF/Anzeigengebühr/Versandetikett split a CSV import would give them.
    let feesWarning: string | undefined;
    try {
      const financesResult = await backfillEbayFinances(isoDateDaysAgo(APP_VISIT_LOOKBACK_DAYS), isoDateDaysAgo(0));
      if (financesResult.error) {
        feesWarning = 'Fee breakdown incomplete: ' + financesResult.error;
      }
    } catch (e) {
      feesWarning = 'Fee breakdown incomplete: ' + (e instanceof Error ? e.message : 'Sell Finances API failed');
    }

    const { report, newOrderIds } = await rebuildApiSyncReport();
    await upsertEbayTransactionReport(report);
    notifyEbayTxReportUpdated();

    const orderRowCount = report.rows.filter((r) => r.kind === 'order').length;
    return {
      status: 'ok',
      added: newOrderIds.length,
      total: orderRowCount,
      upToDate: newOrderIds.length === 0,
      feesWarning,
    };
  } catch (e) {
    appVisitSyncRan = false;
    return {
      status: 'error',
      error: e instanceof Error ? e.message : 'eBay order sync failed',
    };
  }
}
