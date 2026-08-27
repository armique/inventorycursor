import type {
  ActionHistoryEntry,
  BulkImportRecord,
  BusinessSettings,
  DashboardPreferences,
  Expense,
  InventoryItem,
} from '../types';
import type { EbayOrderRecord } from '../services/ebayOrderIndex';

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
    exportedAt: new Date().toISOString(),
  };
}

export function downloadFullBackupJson(backup: BackupData): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `deinventory-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
