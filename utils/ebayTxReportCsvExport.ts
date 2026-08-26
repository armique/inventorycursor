import type { EbayTxLabelOverride } from '../services/ebayTransactionReportStore';
import {
  applyEbayTxLabelOverrides,
  buildEbayTxOrderLedgers,
  classifyEbayTxType,
  ebayTxImportedCoverage,
  isEbayTxAdFee,
  mergeEbayTxReports,
  type EbayTxReport,
  type EbayTxRow,
} from './ebayTransactionReport';

function csvEscape(value: string | number | null | undefined): string {
  if (value == null) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const CSV_HEADERS = [
  'Date',
  'Type',
  'Kind',
  'Source',
  'Row ID',
  'Order',
  'Buyer username',
  'Buyer name',
  'Title',
  'Description',
  'Item EUR',
  'Ship EUR',
  'FVF EUR',
  'Ads EUR',
  'Label EUR',
  'Gross EUR',
  'Pocket EUR',
  'Net EUR',
  'Listing ID',
  'SKU',
  'City',
  'Zip',
  'Country',
  'Reference',
  'Payout date',
  'Payout ID',
  'Currency',
];

function rowToCsvCells(
  row: EbayTxRow,
  ledgers: ReturnType<typeof applyEbayTxLabelOverrides>
): (string | number)[] {
  const isOrder = row.kind === 'order';
  const ledger = row.orderId ? ledgers.get(row.orderId) || null : null;
  const ads = isOrder ? ledger?.adsEur ?? null : isEbayTxAdFee(row) ? row.netEur : null;
  const label = isOrder ? ledger?.labelEur ?? null : row.kind === 'label' ? row.netEur : null;
  const fvf = isOrder ? ledger?.fvfEur ?? null : null;
  const rolledIntoOrder = !isOrder && !!row.orderId && (row.kind === 'label' || isEbayTxAdFee(row));
  const pocket = isOrder ? ledger?.pocketEur ?? row.netEur : rolledIntoOrder ? null : row.netEur;

  return [
    row.createdAt || '',
    row.typeRaw || classifyEbayTxType(row.typeRaw),
    row.kind,
    row.source === 'inventory' ? 'inventory' : 'csv',
    row.id,
    row.orderId || '',
    row.buyerUsername || '',
    row.buyerName || '',
    row.title || '',
    row.description || '',
    isOrder ? ledger?.itemEur ?? row.itemSubtotalEur ?? '' : row.itemSubtotalEur ?? '',
    isOrder ? ledger?.buyerShipEur ?? row.shippingEur ?? '' : row.shippingEur ?? '',
    fvf ?? '',
    ads ?? '',
    label ?? '',
    isOrder ? ledger?.grossEur ?? row.grossEur ?? '' : row.grossEur ?? '',
    pocket ?? '',
    row.netEur ?? '',
    row.listingId || '',
    row.sku || '',
    row.city || '',
    row.zip || '',
    row.country || '',
    row.reference || '',
    row.payoutDate || '',
    row.payoutId || '',
    row.currency || 'EUR',
  ];
}

export type EbayTxCsvExportMeta = {
  coverage?: string;
  inventoryRowCount?: number;
  csvRowCount?: number;
  note?: string;
};

/** Flat CSV of Abrechnung table rows (CSV import + inventory ledger, as shown in the UI). */
export function buildEbayTxRowsCsv(
  rows: EbayTxRow[],
  labelOverrides: Record<string, EbayTxLabelOverride> = {},
  meta?: EbayTxCsvExportMeta
): { csv: string; rowCount: number } {
  const sorted = [...rows].sort((a, b) => {
    const cmp = (b.createdSort || '').localeCompare(a.createdSort || '');
    if (cmp !== 0) return cmp;
    return a.id.localeCompare(b.id);
  });
  const ledgers = applyEbayTxLabelOverrides(buildEbayTxOrderLedgers(sorted), labelOverrides);
  const inventoryRowCount = sorted.filter((row) => row.source === 'inventory').length;
  const csvRowCount = sorted.length - inventoryRowCount;

  const metaLines = [
    `# inventory-pro eBay Abrechnung backup`,
    `# format,inventory-pro-abrechnung-v1`,
    `# generatedAt,${new Date().toISOString()}`,
    ...(meta?.coverage ? [`# coverage,${meta.coverage}`] : []),
    `# rowCount,${sorted.length}`,
    `# csvRows,${meta?.csvRowCount ?? csvRowCount}`,
    `# inventoryRows,${meta?.inventoryRowCount ?? inventoryRowCount}`,
    ...(meta?.note ? [`# note,${meta.note}`] : []),
  ];

  const body = [
    CSV_HEADERS,
    ...sorted.map((row) => rowToCsvCells(row, ledgers)),
  ].map((line) => line.map(csvEscape).join(','));

  return {
    csv: [...metaLines, ...body].join('\r\n'),
    rowCount: sorted.length,
  };
}

/** Flat CSV of imported Transaktionsberichte only (legacy daily copy). */
export function buildEbayTxReportListCsv(
  reports: EbayTxReport[],
  labelOverrides: Record<string, EbayTxLabelOverride> = {}
): { csv: string; rowCount: number; coverage: string } {
  const merged = mergeEbayTxReports(reports);
  const coverageMeta = ebayTxImportedCoverage(reports);
  const coverage = coverageMeta
    ? `${coverageMeta.from} → ${coverageMeta.to}${coverageMeta.reportCount > 1 ? ` (${coverageMeta.reportCount} CSVs)` : ''}`
    : '';

  const { csv, rowCount } = buildEbayTxRowsCsv(merged?.rows || [], labelOverrides, { coverage });
  return { csv, rowCount, coverage };
}

export const EBAY_ABRECHNUNG_BACKUP_FILE_NAME = 'ebay-abrechnung-backup.csv';

export function ebayTxBackupExportFileName(): string {
  return EBAY_ABRECHNUNG_BACKUP_FILE_NAME;
}

/** @deprecated Use ebayTxBackupExportFileName */
export function ebayTxDailyExportFileName(_day?: string): string {
  return EBAY_ABRECHNUNG_BACKUP_FILE_NAME;
}

export async function saveEbayTxCsvBackupToProject(
  rows: EbayTxRow[],
  labelOverrides: Record<string, EbayTxLabelOverride> = {},
  meta?: EbayTxCsvExportMeta
): Promise<
  | { saved: true; fileName: string; rowCount: number; backupPath?: string | null; bytes?: number; renamed?: boolean }
  | { saved: false; fileName: string; rowCount: number; reason: 'dev-only' | 'empty' | 'offline' | 'error'; error?: string }
> {
  if (!import.meta.env.DEV) {
    return { saved: false, fileName: EBAY_ABRECHNUNG_BACKUP_FILE_NAME, rowCount: 0, reason: 'dev-only' };
  }
  const { csv, rowCount } = buildEbayTxRowsCsv(rows, labelOverrides, meta);
  if (!rowCount) {
    return { saved: false, fileName: EBAY_ABRECHNUNG_BACKUP_FILE_NAME, rowCount: 0, reason: 'empty' };
  }
  try {
    const res = await fetch('/api/ebay-abrechnung-backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        csv,
        fileName: EBAY_ABRECHNUNG_BACKUP_FILE_NAME,
        rowCount,
        coverage: meta?.coverage ?? null,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
    }
    const payload = (await res.json()) as {
      backupPath?: string | null;
      bytes?: number;
      fileName?: string;
      renamed?: boolean;
    };
    return {
      saved: true,
      fileName: payload.fileName || EBAY_ABRECHNUNG_BACKUP_FILE_NAME,
      rowCount,
      backupPath: payload.backupPath ?? null,
      bytes: payload.bytes,
      renamed: payload.renamed,
    };
  } catch (err) {
    console.warn('[ebay-abrechnung] Project backup save failed:', err);
    return {
      saved: false,
      fileName: EBAY_ABRECHNUNG_BACKUP_FILE_NAME,
      rowCount,
      reason: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function downloadEbayTxCsvBackup(
  rows: EbayTxRow[],
  labelOverrides: Record<string, EbayTxLabelOverride> = {},
  meta?: EbayTxCsvExportMeta
): { fileName: string; rowCount: number } {
  const fileName = ebayTxBackupExportFileName();
  const { csv, rowCount } = buildEbayTxRowsCsv(rows, labelOverrides, meta);
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return { fileName, rowCount };
}
