/**
 * Open eBay sales that still need an inventory item attached.
 * Linked lines (item.ebayOrderId) drop out of this list.
 */
import { InventoryItem, ItemStatus } from '../types';
import type { EbayOrderLineItem, EbayOrderRecord } from '../services/ebayOrderIndex';
import { getLinePayout, type LinePayout } from './ebayOrderPayout';
import { isOrderCancelled, isOrderFullyRefunded } from './ebayOrderFinancial';
import {
  buildClaimedLineKeys,
  lineItemClaimKey,
} from './ebayOrderLinkAnalysis';
import {
  scoreItemAgainstOrderLine,
  type EbayOrderMatchKind,
} from './ebayOrderMatch';

export interface OpenEbayItemSuggestion {
  item: InventoryItem;
  matchScore: number;
  matchKind: EbayOrderMatchKind;
}

export interface OpenEbayOrderLine {
  key: string;
  order: EbayOrderRecord;
  lineItem: EbayOrderLineItem;
  payout: LinePayout;
  suggestions: OpenEbayItemSuggestion[];
}

export function isEbayBindCandidate(item: InventoryItem): boolean {
  if (item.ebayOrderId?.trim()) return false;
  if (item.status !== ItemStatus.IN_STOCK && item.status !== ItemStatus.ORDERED) return false;
  return true;
}

export function findItemsForOpenOrderLine(
  line: EbayOrderLineItem,
  order: EbayOrderRecord,
  items: InventoryItem[],
  options?: { limit?: number; minScore?: number }
): OpenEbayItemSuggestion[] {
  const limit = options?.limit ?? 5;
  const minScore = options?.minScore ?? 28;
  const scored: OpenEbayItemSuggestion[] = [];
  for (const item of items) {
    if (!isEbayBindCandidate(item)) continue;
    const { matchScore, matchKind } = scoreItemAgainstOrderLine(item, order, line);
    if (matchKind === 'listingId' || matchKind === 'sku' || matchScore >= minScore) {
      scored.push({ item, matchScore, matchKind });
    }
  }
  return scored.sort((a, b) => b.matchScore - a.matchScore).slice(0, limit);
}

export function buildOpenEbayOrderLines(
  items: InventoryItem[],
  orders: EbayOrderRecord[]
): OpenEbayOrderLine[] {
  const claimed = buildClaimedLineKeys(items, orders);
  const pool = items.filter(isEbayBindCandidate);
  const out: OpenEbayOrderLine[] = [];

  for (const order of orders) {
    if (isOrderCancelled(order) || isOrderFullyRefunded(order)) continue;
    for (const line of order.lineItems.length ? order.lineItems : [{ sku: null, title: '(no title)' }]) {
      const key = lineItemClaimKey(order.orderId, line);
      if (claimed.has(key)) continue;
      out.push({
        key,
        order,
        lineItem: line,
        payout: getLinePayout(order, line),
        suggestions: findItemsForOpenOrderLine(line, order, pool),
      });
    }
  }

  return out.sort((a, b) => (b.order.creationDate || '').localeCompare(a.order.creationDate || ''));
}

export function countOpenEbayOrderLines(items: InventoryItem[], orders: EbayOrderRecord[]): number {
  const claimed = buildClaimedLineKeys(items, orders);
  let n = 0;
  for (const order of orders) {
    if (isOrderCancelled(order) || isOrderFullyRefunded(order)) continue;
    const lines = order.lineItems.length ? order.lineItems : [{ sku: null, title: '(no title)' }];
    for (const line of lines) {
      if (!claimed.has(lineItemClaimKey(order.orderId, line))) n += 1;
    }
  }
  return n;
}
