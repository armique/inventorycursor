import type { EbayOrderRecord } from '../services/ebayOrderIndex';
import { getOrderEffectiveNet } from './ebayOrderFinancial';

export type SnapshotSyncStatus = 'api_only' | 'csv_only' | 'both' | 'both_diff';

export interface SnapshotCompareRow {
  orderId: string;
  status: SnapshotSyncStatus;
  inApi: boolean;
  inCsv: boolean;
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
  bothDiffCount: number;
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
    else if (diffs.length) status = 'both_diff';
    else status = 'both';

    const flags: string[] = [];
    if (status === 'api_only') {
      flags.push('Missing in CSV — not in Transaktionsbericht export or no Bestellnummer row.');
      if (api?.cancelState) flags.push(`Cancel: ${api.cancelState}`);
      if (api?.orderPaymentStatus && api.orderPaymentStatus !== 'PAID') {
        flags.push(`Payment: ${api.orderPaymentStatus}`);
      }
    }
    if (status === 'csv_only') {
      flags.push('Missing in API — widen backfill range or order never returned by Fulfillment API.');
    }

    rows.push({
      orderId: api?.orderId || csv!.orderId,
      status,
      inApi,
      inCsv,
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
      s === 'api_only' ? 0 : s === 'csv_only' ? 1 : s === 'both_diff' ? 2 : 3;
    const dr = rank(a.status) - rank(b.status);
    if (dr !== 0) return dr;
    return (b.dateApi || b.dateCsv || '').localeCompare(a.dateApi || a.dateCsv || '');
  });

  const apiOnly = rows.filter((r) => r.status === 'api_only');
  const csvOnly = rows.filter((r) => r.status === 'csv_only');

  return {
    generatedAt: new Date().toISOString(),
    apiCount: apiOrders.length,
    csvCount: csvOrders.length,
    apiOnlyCount: apiOnly.length,
    csvOnlyCount: csvOnly.length,
    bothCount: rows.filter((r) => r.status === 'both').length,
    bothDiffCount: rows.filter((r) => r.status === 'both_diff').length,
    rows,
    apiOnly,
    csvOnly,
  };
}
