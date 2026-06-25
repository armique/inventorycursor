import type { ActionHistoryEntry, InventoryItem } from '../types';
import { ItemStatus } from '../types';

const ARCHIVE_KEY = 'action_history_archive_v1';
const RETENTION_DAYS = 90;

export function pruneActionHistory(entries: ActionHistoryEntry[]): {
  active: ActionHistoryEntry[];
  archivedCount: number;
} {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const active: ActionHistoryEntry[] = [];
  const archived: ActionHistoryEntry[] = [];

  for (const e of entries) {
    const t = new Date(e.timestamp).getTime();
    if (Number.isFinite(t) && t < cutoff) archived.push(e);
    else active.push(e);
  }

  if (archived.length > 0) {
    try {
      const prev = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]') as ActionHistoryEntry[];
      localStorage.setItem(ARCHIVE_KEY, JSON.stringify([...archived, ...prev].slice(0, 2000)));
    } catch {
      /* ignore */
    }
  }

  return { active, archivedCount: archived.length };
}

/** Revert a sale back to In Stock (#62). */
export function applySaleRevert(items: InventoryItem[], itemId: string): InventoryItem[] {
  return items.map((i) => {
    if (i.id !== itemId) return i;
    if (i.status !== ItemStatus.SOLD) return i;
    const { sellPrice, sellDate, profit, paymentType, platformSold, feeAmount, hasFee, invoiceNumber, customer, ebayOrderId, ...rest } = i;
    return {
      ...rest,
      status: ItemStatus.IN_STOCK,
      sellPrice: undefined,
      sellDate: undefined,
      profit: undefined,
      paymentType: undefined,
      platformSold: undefined,
      feeAmount: undefined,
      hasFee: false,
      invoiceNumber: undefined,
      customer: undefined,
      ebayOrderId: undefined,
    };
  });
}
