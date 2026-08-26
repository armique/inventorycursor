import type { InventoryItem } from '../types';
import type { EbayOrderRecord } from '../services/ebayOrderIndex';
import {
  buildBindCandidateIndex,
  findItemsForOpenOrderLine,
  listOpenEbayOrderLines,
  type OpenEbayItemSuggestion,
  type OpenEbayOrderLine,
} from './ebayOpenOrders';
import { orderItemLinkCompatible } from './orderMatcherCompatibility';
import { getOrderMatcherIgnoredKeys } from './orderMatcherIgnored';

export interface OrderMatcherRow {
  key: string;
  order: EbayOrderRecord;
  lineItem: OpenEbayOrderLine['lineItem'];
  payout: OpenEbayOrderLine['payout'];
  /** Best compatible suggestion (may differ from raw scorer top hit). */
  topMatch: OpenEbayItemSuggestion | null;
  /** All compatible suggestions, best first. */
  compatibleSuggestions: OpenEbayItemSuggestion[];
  ignored: boolean;
}

function filterCompatibleSuggestions(
  orderTitle: string,
  suggestions: OpenEbayItemSuggestion[]
): OpenEbayItemSuggestion[] {
  return suggestions.filter((s) => orderItemLinkCompatible(orderTitle, s.item));
}

export function buildOrderMatcherRows(
  items: InventoryItem[],
  orders: EbayOrderRecord[],
  options?: { includeIgnored?: boolean; suggestionLimit?: number }
): OrderMatcherRow[] {
  const includeIgnored = options?.includeIgnored ?? false;
  const suggestionLimit = options?.suggestionLimit ?? 8;
  const index = buildBindCandidateIndex(items);
  const open = listOpenEbayOrderLines(items, orders);
  const ignoredKeys = getOrderMatcherIgnoredKeys();

  const rows: OrderMatcherRow[] = [];
  for (const row of open) {
    const ignored = ignoredKeys.has(row.key);
    if (ignored && !includeIgnored) continue;

    const raw = findItemsForOpenOrderLine(row.lineItem, row.order, index, {
      limit: suggestionLimit * 3,
      minScore: 20,
    });
    const compatible = filterCompatibleSuggestions(row.lineItem.title || '', raw).slice(
      0,
      suggestionLimit
    );

    rows.push({
      key: row.key,
      order: row.order,
      lineItem: row.lineItem,
      payout: row.payout,
      topMatch: compatible[0] ?? null,
      compatibleSuggestions: compatible,
      ignored,
    });
  }

  return rows;
}

/** Cheap badge count — open Hub lines minus ignored (no suggestion scoring). */
export function countOrderMatcherQueue(
  items: InventoryItem[],
  orders: EbayOrderRecord[]
): number {
  const ignored = getOrderMatcherIgnoredKeys();
  let n = 0;
  for (const row of listOpenEbayOrderLines(items, orders)) {
    if (!ignored.has(row.key)) n += 1;
  }
  return n;
}
