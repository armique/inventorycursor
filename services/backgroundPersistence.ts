import {
  persistDashboardPreferencesToLocalStorage,
  type DashboardPreferences,
} from './dashboardPreferences';
import { rebuildItemSalesPool } from '../utils/itemSalesPool';
import type { InventoryItem } from '../types';

/** Yield control so typing / clicks stay responsive during large saves. */
export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(() => resolve(), { timeout: 120 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

export type LocalPersistSnapshot = {
  itemsJson: string;
  trashJson: string;
  expensesJson: string;
  settingsJson: string;
  monthlyGoal: string;
  categoriesJson: string;
  categoryFieldsJson: string;
  recurringExpensesJson?: string;
  dashboardPrefs: DashboardPreferences;
  actionHistoryJson?: string;
  bulkImportsJson?: string;
};

/** Stringify once, then write localStorage keys one at a time with yields between. */
export async function persistSnapshotToLocalStorage(snapshot: LocalPersistSnapshot): Promise<void> {
  await yieldToMain();
  localStorage.setItem('inventory_items', snapshot.itemsJson);
  try {
    const items = JSON.parse(snapshot.itemsJson) as InventoryItem[];
    if (Array.isArray(items)) rebuildItemSalesPool(items);
  } catch {
    /* ignore */
  }
  await yieldToMain();
  localStorage.setItem('inventory_trash', snapshot.trashJson);
  await yieldToMain();
  localStorage.setItem('inventory_expenses', snapshot.expensesJson);
  localStorage.setItem('business_settings', snapshot.settingsJson);
  localStorage.setItem('monthly_profit_goal', snapshot.monthlyGoal);
  await yieldToMain();
  localStorage.setItem('custom_categories', snapshot.categoriesJson);
  localStorage.setItem('custom_category_fields', snapshot.categoryFieldsJson);
  if (snapshot.recurringExpensesJson !== undefined) {
    localStorage.setItem('recurring_expenses', snapshot.recurringExpensesJson);
  }
  persistDashboardPreferencesToLocalStorage(snapshot.dashboardPrefs);
  if (snapshot.actionHistoryJson !== undefined) {
    await yieldToMain();
    localStorage.setItem('action_history', snapshot.actionHistoryJson);
  }
  if (snapshot.bulkImportsJson !== undefined) {
    await yieldToMain();
    localStorage.setItem('bulk_imports', snapshot.bulkImportsJson);
  }
}

export function scheduleBackgroundWork(work: () => void | Promise<void>): void {
  const run = () => {
    void Promise.resolve(work()).catch((err) => console.warn('Background persist failed', err));
  };
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(() => run(), { timeout: 3000 });
  } else {
    setTimeout(run, 0);
  }
}
