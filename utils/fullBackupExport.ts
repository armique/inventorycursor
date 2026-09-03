import type {
  ActionHistoryEntry,
  BulkImportRecord,
  BusinessSettings,
  DashboardPreferences,
  Expense,
  InventoryItem,
} from '../types';
import type { EbayOrderRecord } from '../services/ebayOrderIndex';
import type { EbayTxReport } from './ebayTransactionReport';
import type { EbayTxLabelOverride } from '../services/ebayTransactionReportStore';

/** Full-fidelity snapshot of everything needed to restore the app — same shape used
 *  by the local JSON download/restore and the GitHub backup push. */
export interface BackupData {
  inventory: InventoryItem[];
  trash: InventoryItem[];
  expenses: Expense[];
  settings: BusinessSettings;
  goals: { monthly: number };
  categories: Record<string, string[]>;
  categoryFields: Record<string, string[]>;
  /** Dashboard widgets, tasks, time filter (optional in older backups). */
  dashboard?: DashboardPreferences;
  actionHistory?: ActionHistoryEntry[];
  bulkImports?: BulkImportRecord[];
  /** Cached eBay order history (API + CSV merged) — so a JSON backup can restore it too. */
  ebayOrders?: EbayOrderRecord[];
  /** eBay Abrechnung — imported CSV / API-sync reports with their real rows, plus any manual
   *  DHL label overrides. Previously only backed up as a separate CSV; now travels with every
   *  other backup so one JSON restores everything, including after an incident like today's. */
  ebayTxReports?: EbayTxReport[];
  ebayTxLabelOverrides?: Record<string, EbayTxLabelOverride>;
  exportedAt: string;
}

export function buildFullBackupPayload(snapshot: {
  items: InventoryItem[];
  trash: InventoryItem[];
  expenses: Expense[];
  businessSettings: BusinessSettings;
  monthlyGoal: number;
  categories: Record<string, string[]>;
  categoryFields: Record<string, string[]>;
  dashboardPreferences?: DashboardPreferences;
  actionHistory?: ActionHistoryEntry[];
  bulkImports?: BulkImportRecord[];
  ebayOrders?: EbayOrderRecord[];
  ebayTxReports?: EbayTxReport[];
  ebayTxLabelOverrides?: Record<string, EbayTxLabelOverride>;
}): BackupData {
  return {
    inventory: snapshot.items,
    trash: snapshot.trash,
    expenses: snapshot.expenses || [],
    settings: snapshot.businessSettings,
    goals: { monthly: snapshot.monthlyGoal },
    categories: snapshot.categories,
    categoryFields: snapshot.categoryFields,
    ...(snapshot.dashboardPreferences ? { dashboard: snapshot.dashboardPreferences } : {}),
    ...(snapshot.actionHistory?.length ? { actionHistory: snapshot.actionHistory } : {}),
    ...(snapshot.bulkImports?.length ? { bulkImports: snapshot.bulkImports } : {}),
    ...(snapshot.ebayOrders?.length ? { ebayOrders: snapshot.ebayOrders } : {}),
    ...(snapshot.ebayTxReports?.length ? { ebayTxReports: snapshot.ebayTxReports } : {}),
    ...(snapshot.ebayTxLabelOverrides && Object.keys(snapshot.ebayTxLabelOverrides).length
      ? { ebayTxLabelOverrides: snapshot.ebayTxLabelOverrides }
      : {}),
    exportedAt: new Date().toISOString(),
  };
}

/** Safe filename timestamp: `2026-09-02T134530` */
export function backupFileTimestamp(d = new Date()): string {
  return d.toISOString().replace(/[:.]/g, '').slice(0, 15);
}

export function defaultBackupFileName(d = new Date()): string {
  return `deinventory-backup-${backupFileTimestamp(d)}.json`;
}

export function downloadFullBackupJson(backup: BackupData, options?: { fileName?: string }): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = options?.fileName || defaultBackupFileName();
  a.click();
  URL.revokeObjectURL(url);
}
