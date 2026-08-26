import type { InventoryItem } from '../types';
import { ItemStatus } from '../types';
import { ebayTxOrderSellDate, type EbayTxRow } from './ebayTransactionReport';

export type EbayTxSellDateBackfillResult = {
  updates: InventoryItem[];
  unchanged: number;
  missingInCsv: string[];
};

export function buildEbayTxOrderSellDateByOrderId(rows: EbayTxRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.kind !== 'order' || !row.orderId) continue;
    const date = ebayTxOrderSellDate(row);
    if (!date) continue;
    const key = row.orderId.trim().toLowerCase();
    if (!key || map.has(key)) continue;
    map.set(key, date);
  }
  return map;
}

/** Listing id → CSV Bestellung date only when that listing appears on exactly one order. */
export function buildEbayTxOrderSellDateByUniqueListingId(rows: EbayTxRow[]): Map<string, string> {
  const counts = new Map<string, number>();
  const dates = new Map<string, string>();
  for (const row of rows) {
    if (row.kind !== 'order') continue;
    const listingId = (row.listingId || '').trim();
    if (!listingId) continue;
    const date = ebayTxOrderSellDate(row);
    if (!date) continue;
    counts.set(listingId, (counts.get(listingId) || 0) + 1);
    if (!dates.has(listingId)) dates.set(listingId, date);
  }
  const unique = new Map<string, string>();
  for (const [listingId, count] of counts) {
    if (count !== 1) continue;
    const date = dates.get(listingId);
    if (date) unique.set(listingId, date);
  }
  return unique;
}

function resolveCsvSellDateForItem(
  item: InventoryItem,
  byOrder: Map<string, string>,
  byUniqueListing: Map<string, string>
): { date: string | null; missingOrderId?: string } {
  const orderId = (item.ebayOrderId || '').trim();
  if (orderId) {
    const date = byOrder.get(orderId.toLowerCase());
    if (date) return { date };
    return { date: null, missingOrderId: orderId };
  }

  const listingId = (item.ebayListingId || '').trim();
  if (listingId) {
    const date = byUniqueListing.get(listingId);
    if (date) return { date };
  }
  return { date: null };
}

/**
 * Patch sellDate from CSV Bestellung date (source of truth):
 * - items with ebayOrderId → that order's CSV date
 * - sold/traded items with a listing id that appears on exactly one CSV order → that date
 */
export function backfillEbayTxLinkedSellDates(
  items: InventoryItem[],
  rows: EbayTxRow[]
): EbayTxSellDateBackfillResult {
  const byOrder = buildEbayTxOrderSellDateByOrderId(rows);
  const byUniqueListing = buildEbayTxOrderSellDateByUniqueListingId(rows);
  const updates: InventoryItem[] = [];
  const missingSet = new Set<string>();
  let unchanged = 0;

  for (const item of items) {
    const resolved = resolveCsvSellDateForItem(item, byOrder, byUniqueListing);
    if (resolved.missingOrderId) missingSet.add(resolved.missingOrderId);
    if (!resolved.date) continue;

    // Listing-only matches: only rewrite dates on sold/traded rows (avoid retagging stock).
    if (!(item.ebayOrderId || '').trim()) {
      if (item.status !== ItemStatus.SOLD && item.status !== ItemStatus.TRADED) continue;
    }

    const csvDate = resolved.date;
    const current = (item.sellDate || '').slice(0, 10);
    const hasStaleContainer = Boolean(item.containerSoldDate?.trim());
    if (current === csvDate && !hasStaleContainer) {
      unchanged += 1;
      continue;
    }

    updates.push({
      ...item,
      sellDate: csvDate,
      containerSoldDate: undefined,
    });
  }

  return {
    updates,
    unchanged,
    missingInCsv: [...missingSet],
  };
}

export function countEbayTxLinkedSellDateFixes(items: InventoryItem[], rows: EbayTxRow[]): number {
  return backfillEbayTxLinkedSellDates(items, rows).updates.length;
}
