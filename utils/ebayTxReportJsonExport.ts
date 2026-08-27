import type { EbayTxLabelOverride } from '../services/ebayTransactionReportStore';
import type { EbayTxReport } from './ebayTransactionReport';

/** Same shape as BackupData's ebayTxReports/ebayTxLabelOverrides (utils/fullBackupExport.ts),
 *  so this file restores the same way a full JSON backup does. */
export interface EbayTxJsonBackup {
  format: 'inventory-pro-abrechnung-v1';
  exportedAt: string;
  ebayTxReports: EbayTxReport[];
  ebayTxLabelOverrides: Record<string, EbayTxLabelOverride>;
}

export function buildEbayTxJsonBackup(
  reports: EbayTxReport[],
  labelOverrides: Record<string, EbayTxLabelOverride> = {}
): EbayTxJsonBackup {
  return {
    format: 'inventory-pro-abrechnung-v1',
    exportedAt: new Date().toISOString(),
    ebayTxReports: reports,
    ebayTxLabelOverrides: labelOverrides,
  };
}

export function downloadEbayTxJsonBackup(
  reports: EbayTxReport[],
  labelOverrides: Record<string, EbayTxLabelOverride> = {}
): { fileName: string; rowCount: number } {
  const backup = buildEbayTxJsonBackup(reports, labelOverrides);
  const rowCount = reports.reduce((sum, r) => sum + (r.rows?.length || 0), 0);
  const fileName = `ebay-abrechnung-backup-${new Date().toISOString().slice(0, 10)}.json`;
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
  return { fileName, rowCount };
}
