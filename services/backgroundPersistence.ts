import { persistDashboardPreferencesToLocalStorage } from './dashboardPreferences';
import { scheduleItemSalesPoolRebuild } from '../utils/itemSalesPool';
import { writeInventoryItemsToDB, clearPendingItemPatches } from './inventoryItemsStore';
import type { InventoryItem, DashboardPreferences } from '../types';

/** Yield control so typing / clicks stay responsive during large saves. */
let lastInteractiveAt = 0;

function noteInteractive(): void {
  lastInteractiveAt = Date.now();
}

if (typeof window !== 'undefined') {
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  window.addEventListener('pointerdown', noteInteractive, opts);
  window.addEventListener('wheel', noteInteractive, opts);
  window.addEventListener('touchmove', noteInteractive, opts);
  window.addEventListener('keydown', noteInteractive, opts);
}

function waitUntilQuiet(maxWaitMs: number): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const attempt = () => {
      const recentlyBusy = Date.now() - lastInteractiveAt < 280;
      if (recentlyBusy && Date.now() - started < maxWaitMs) {
        setTimeout(attempt, 60);
        return;
      }
      resolve();
    };
    attempt();
  });
}

export function yieldToMain(maxWaitMs = 2500): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      void waitUntilQuiet(maxWaitMs).then(resolve);
    };
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(finish, { timeout: Math.min(maxWaitMs, 4000) });
    } else {
      setTimeout(finish, 0);
    }
  });
}

/** Stringify inventory without locking the tab for one 1.5MiB JSON.stringify. */
export async function stringifyItemsJson(items: InventoryItem[]): Promise<string> {
  if (items.length < 60) return JSON.stringify(items);
  const parts: string[] = new Array(items.length);
  for (let i = 0; i < items.length; i++) {
    parts[i] = JSON.stringify(items[i]);
    if (i > 0 && i % 28 === 0) await yieldToMain(400);
  }
  return `[${parts.join(',')}]`;
}

export type LocalPersistSnapshot = {
  /** @deprecated Items now go to IndexedDB directly from `items` — no stringify needed. */
  itemsJson?: string;
  /** In-memory inventory, written to IndexedDB as-is (structured clone — no JSON round-trip). */
  items?: InventoryItem[];
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

function itemsForSalesPool(snapshot: LocalPersistSnapshot): InventoryItem[] | null {
  if (Array.isArray(snapshot.items)) return snapshot.items;
  if (!snapshot.itemsJson) return null;
  try {
    const parsed = JSON.parse(snapshot.itemsJson) as InventoryItem[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Each yield between localStorage writes below is capped short — see MAX_DEFER_MS above for why. */
const PERSIST_YIELD_MS = 500;

/** Stringify once, then write localStorage keys one at a time with yields between. */
export async function persistSnapshotToLocalStorage(snapshot: LocalPersistSnapshot): Promise<void> {
  await yieldToMain(PERSIST_YIELD_MS);
  const items = itemsForSalesPool(snapshot);
  if (items) {
    try {
      await writeInventoryItemsToDB(items);
      clearPendingItemPatches();
      scheduleItemSalesPoolRebuild(items);
    } catch (e) {
      // The pending-patches log (written synchronously at edit time) still has every
      // change — nothing is lost, this save just retries on the next debounced pass.
      console.warn('[persist] IndexedDB items write failed, will retry:', e);
    }
  }
  await yieldToMain(PERSIST_YIELD_MS);
  localStorage.setItem('inventory_trash', snapshot.trashJson);
  await yieldToMain(PERSIST_YIELD_MS);
  localStorage.setItem('inventory_expenses', snapshot.expensesJson);
  localStorage.setItem('business_settings', snapshot.settingsJson);
  localStorage.setItem('monthly_profit_goal', snapshot.monthlyGoal);
  await yieldToMain(PERSIST_YIELD_MS);
  localStorage.setItem('custom_categories', snapshot.categoriesJson);
  localStorage.setItem('custom_category_fields', snapshot.categoryFieldsJson);
  if (snapshot.recurringExpensesJson !== undefined) {
    localStorage.setItem('recurring_expenses', snapshot.recurringExpensesJson);
  }
  persistDashboardPreferencesToLocalStorage(snapshot.dashboardPrefs);
  if (snapshot.actionHistoryJson !== undefined) {
    await yieldToMain(PERSIST_YIELD_MS);
    localStorage.setItem('action_history', snapshot.actionHistoryJson);
  }
  if (snapshot.bulkImportsJson !== undefined) {
    await yieldToMain(PERSIST_YIELD_MS);
    localStorage.setItem('bulk_imports', snapshot.bulkImportsJson);
  }
}

/**
 * Deferring for a quiet gap keeps typing/clicking smooth, but during a workflow of
 * continuous back-to-back actions (e.g. bulk-linking hundreds of orders) a 280ms quiet
 * gap may never occur — every click resets it, so the write could be deferred forever
 * and never reach localStorage. Cap the total wait so a save always lands within a few
 * seconds even under nonstop interaction; refreshing mid-burst can only ever lose that
 * bounded window, never everything.
 */
const MAX_DEFER_MS = 3000;

export function scheduleBackgroundWork(work: () => void | Promise<void>): void {
  const run = () => {
    void Promise.resolve(work()).catch((err) => console.warn('Background persist failed', err));
  };
  const scheduledAt = Date.now();
  const start = () => {
    const stillBusy = Date.now() - lastInteractiveAt < 280;
    const withinBudget = Date.now() - scheduledAt < MAX_DEFER_MS;
    if (stillBusy && withinBudget) {
      setTimeout(start, 140);
      return;
    }
    run();
  };
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(start, { timeout: 20000 });
  } else {
    setTimeout(start, 0);
  }
}
