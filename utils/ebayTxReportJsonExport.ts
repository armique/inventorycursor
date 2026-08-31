import type { EbayTxLabelOverride } from '../services/ebayTransactionReportStore';
import type { EbayTxReport } from './ebayTransactionReport';
import type { InventoryItem } from '../types';

/** Includes raw CSV reports, label overrides, and all linked inventory records. */
export interface EbayTxJsonBackup {
  format: 'inventory-pro-abrechnung-v1' | 'inventory-pro-abrechnung-v2';
  exportedAt: string;
  ebayTxReports: EbayTxReport[];
  ebayTxLabelOverrides: Record<string, EbayTxLabelOverride>;
  linkedItems?: InventoryItem[];
  inventoryCount?: number;
  linkedCount?: number;
}

export function buildEbayTxJsonBackup(
  reports: EbayTxReport[],
  labelOverrides: Record<string, EbayTxLabelOverride> = {},
  items: InventoryItem[] = []
): EbayTxJsonBackup {
  // Capture items that have an eBay order link, sell date, or sell proceeds
  const linkedItems = items.filter((i) => Boolean(i.ebayOrderId || i.sellDate || i.sellPrice));
  return {
    format: 'inventory-pro-abrechnung-v2',
    exportedAt: new Date().toISOString(),
    ebayTxReports: reports,
    ebayTxLabelOverrides: labelOverrides,
    linkedItems,
    inventoryCount: items.length,
    linkedCount: linkedItems.length,
  };
}

export function downloadEbayTxJsonBackup(
  reports: EbayTxReport[],
  labelOverrides: Record<string, EbayTxLabelOverride> = {},
  items: InventoryItem[] = []
): { fileName: string; rowCount: number; linkedCount: number } {
  const backup = buildEbayTxJsonBackup(reports, labelOverrides, items);
  const rowCount = reports.reduce((sum, r) => sum + (r.rows?.length || 0), 0);
  const linkedCount = backup.linkedItems?.length || 0;
  const fileName = `ebay-abrechnung-and-links-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return { fileName, rowCount, linkedCount };
}

export function parseEbayTxJsonBackup(jsonText: string): EbayTxJsonBackup {
  const data = JSON.parse(jsonText);
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid JSON file');
  }
  return data as EbayTxJsonBackup;
}

