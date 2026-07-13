import type { EbayOrderRecord } from '../services/ebayOrderIndex';
import { getOrderEffectiveNet } from './ebayOrderFinancial';

export type SnapshotSyncStatus = 'api_only' | 'csv_only' | 'both';

export interface SnapshotCompareRow {
  orderId: string;
  status: SnapshotSyncStatus;
  inApi: boolean;
  inCsv: boolean;
  hasFieldDiffs: boolean;
  dateApi: string | null;
  dateCsv: string | null;
  buyerApi: string;
  buyerCsv: string;
  grossApi: number | null;
  grossCsv: number | null;
  netCsv: number | null;
  itemsApi: string;
  itemsCsv: string;
  paymentApi: string | null;
  cancelApi: string | null;
  csvEvents: number;
  diffs: string[];
  flags: string[];
}

export interface SnapshotCompareReport {
  generatedAt: string;
  apiCount: number;
  csvCount: number;
  apiOnlyCount: number;
  csvOnlyCount: number;
  bothCount: number;
  bothWithFieldDiffsCount: number;
  rows: SnapshotCompareRow[];
  apiOnly: SnapshotCompareRow[];
  csvOnly: SnapshotCompareRow[];
}

function buyerLabel(order: EbayOrderRecord | undefined): string {
  if (!order) return '—';
  return order.buyer.fullName || order.buyer.username || '—';
}

function itemsLabel(order: EbayOrderRecord | undefined): string {
  if (!order?.lineItems.length) return '—';
  return order.lineItems.map((li) => li.title).filter(Boolean).join(' · ').slice(0, 120);
}

function normId(id: string): string {
  return id.trim().toLowerCase();
}

/** Side-by-side compare of isolated API and CSV snapshots. */
export function compareApiCsvSnapshots(
  apiOrders: EbayOrderRecord[],
  csvOrders: EbayOrderRecord[]
): SnapshotCompareReport {
  const apiById = new Map(apiOrders.map((o) => [normId(o.orderId), o]));
  const csvById = new Map(csvOrders.map((o) => [normId(o.orderId), o]));
  const allIds = new Set([...apiById.keys(), ...csvById.keys()]);

  const rows: SnapshotCompareRow[] = [];

  for (const id of allIds) {
    const api = apiById.get(id);
    const csv = csvById.get(id);
    const inApi = Boolean(api);
    const inCsv = Boolean(csv);

    const diffs: string[] = [];
    if (api && csv) {
      const bApi = buyerLabel(api);
      const bCsv = buyerLabel(csv);
      if (bApi !== '—' && bCsv !== '—' && bApi.toLowerCase() !== bCsv.toLowerCase()) {
        diffs.push(`Buyer: API "${bApi}" vs CSV "${bCsv}"`);
      }
      if (api.grossTotal != null && csv.grossTotal != null && Math.abs(api.grossTotal - csv.grossTotal) > 0.02) {
        diffs.push(`Gross: API €${api.grossTotal.toFixed(2)} vs CSV €${csv.grossTotal.toFixed(2)}`);
      }
      if (api.creationDate && csv.creationDate && api.creationDate !== csv.creationDate) {
        diffs.push(`Date: API ${api.creationDate} vs CSV ${csv.creationDate}`);
      }
    }

    let status: SnapshotSyncStatus;
    if (inApi && !inCsv) status = 'api_only';
    else if (!inApi && inCsv) status = 'csv_only';
    else status = 'both';

    const hasFieldDiffs = diffs.length > 0;

    const flags: string[] = [];
    if (status === 'api_only') {
      flags.push('Not in CSV export — order ID missing from Transaktionsbericht.');
      if (api?.cancelState) flags.push(`Cancel: ${api.cancelState}`);
      if (api?.orderPaymentStatus && api.orderPaymentStatus !== 'PAID') {
        flags.push(`Payment: ${api.orderPaymentStatus}`);
      }
    }
    if (status === 'csv_only') {
      flags.push('Not in API backfill — widen date range or order not returned by Fulfillment API.');
    }
    if (status === 'both' && hasFieldDiffs) {
      flags.push('Present in both — minor field differences (buyer/date/gross).');
    }
    if (status === 'both' && !hasFieldDiffs) {
      flags.push('Present in both — order ID matched.');
    }

    rows.push({
      orderId: api?.orderId || csv!.orderId,
      status,
      inApi,
      inCsv,
      hasFieldDiffs,
      dateApi: api?.creationDate ?? null,
      dateCsv: csv?.creationDate ?? null,
      buyerApi: buyerLabel(api),
      buyerCsv: buyerLabel(csv),
      grossApi: api?.grossTotal ?? null,
      grossCsv: csv?.grossTotal ?? null,
      netCsv: csv ? getOrderEffectiveNet(csv) : null,
      itemsApi: itemsLabel(api),
      itemsCsv: itemsLabel(csv),
      paymentApi: api?.orderPaymentStatus ?? null,
      cancelApi: api?.cancelState ?? null,
      csvEvents: csv?.financialEvents?.length ?? 0,
      diffs,
      flags,
    });
  }

  rows.sort((a, b) => {
    const rank = (s: SnapshotSyncStatus) =>
      s === 'api_only' ? 0 : s === 'csv_only' ? 1 : 2;
    const dr = rank(a.status) - rank(b.status);
    if (dr !== 0) return dr;
    return (b.dateApi || b.dateCsv || '').localeCompare(a.dateApi || a.dateCsv || '');
  });

  const apiOnly = rows.filter((r) => r.status === 'api_only');
  const csvOnly = rows.filter((r) => r.status === 'csv_only');
  const bothRows = rows.filter((r) => r.status === 'both');

  return {
    generatedAt: new Date().toISOString(),
    apiCount: apiOrders.length,
    csvCount: csvOrders.length,
    apiOnlyCount: apiOnly.length,
    csvOnlyCount: csvOnly.length,
    bothCount: bothRows.length,
    bothWithFieldDiffsCount: bothRows.filter((r) => r.hasFieldDiffs).length,
    rows,
    apiOnly,
    csvOnly,
  };
}
