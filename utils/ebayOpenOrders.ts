/**
 * Open eBay sales that still need an inventory item attached.
 * Linked lines (item.ebayOrderId) drop out of this list.
 *
 * Suggestion matching is indexed (SKU / listing / model tokens) so opening the
 * bind UI does not score every stock row against every order on the main thread.
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
import { extractModelTokens, LISTING_FLUFF_TOKENS, normalizeListingText } from './ebayListingMatch';

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

export interface BindCandidateIndex {
  items: InventoryItem[];
  bySku: Map<string, InventoryItem[]>;
  byListingId: Map<string, InventoryItem[]>;
  byToken: Map<string, InventoryItem[]>;
}

export function isEbayBindCandidate(item: InventoryItem): boolean {
  if (item.ebayOrderId?.trim()) return false;
  if (item.ebayOrderLineKey?.trim()) return false;
  if (
    item.status === ItemStatus.SOLD ||
    item.status === ItemStatus.TRADED ||
    item.status === ItemStatus.GIFTED
  ) {
    return false;
  }
  if (item.status !== ItemStatus.IN_STOCK && item.status !== ItemStatus.ORDERED) return false;
  return true;
}

function pushMap(map: Map<string, InventoryItem[]>, key: string, item: InventoryItem) {
  const k = key.trim().toLowerCase();
  if (!k) return;
  const list = map.get(k);
  if (list) {
    if (!list.includes(item)) list.push(item);
  } else {
    map.set(k, [item]);
  }
}

export function bindIndexTokens(text: string): string[] {
  const out = new Set<string>(extractModelTokens(text || ''));
  for (const w of normalizeListingText(text || '').split(' ')) {
    if (w.length >= 3 && !LISTING_FLUFF_TOKENS.has(w)) out.add(w);
  }
  return [...out];
}

export function buildBindCandidateIndex(items: InventoryItem[]): BindCandidateIndex {
  const pool = items.filter(isEbayBindCandidate);
  const bySku = new Map<string, InventoryItem[]>();
  const byListingId = new Map<string, InventoryItem[]>();
  const byToken = new Map<string, InventoryItem[]>();
  for (const item of pool) {
    if (item.ebaySku) pushMap(bySku, item.ebaySku, item);
    if (item.ebayListingId) pushMap(byListingId, item.ebayListingId, item);
    for (const tok of bindIndexTokens(item.name || '')) pushMap(byToken, tok, item);
  }
  return { items: pool, bySku, byListingId, byToken };
}

function candidatesForLine(line: EbayOrderLineItem, index: BindCandidateIndex): InventoryItem[] {
  const seen = new Set<string>();
  const out: InventoryItem[] = [];
  const add = (list: InventoryItem[] | undefined) => {
    if (!list) return;
    for (const item of list) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  };
  if (line.sku) add(index.bySku.get(line.sku.trim().toLowerCase()));
  if (line.listingId) add(index.byListingId.get(String(line.listingId).trim().toLowerCase()));
  for (const tok of bindIndexTokens(line.title || '')) {
    add(index.byToken.get(tok));
    if (out.length >= 48) break;
  }
  return out;
}

export function findItemsForOpenOrderLine(
  line: EbayOrderLineItem,
  order: EbayOrderRecord,
  itemsOrIndex: InventoryItem[] | BindCandidateIndex,
  options?: { limit?: number; minScore?: number }
): OpenEbayItemSuggestion[] {
  const limit = options?.limit ?? 5;
  const minScore = options?.minScore ?? 28;
  const index = Array.isArray(itemsOrIndex)
    ? buildBindCandidateIndex(itemsOrIndex)
    : itemsOrIndex;
  const scored: OpenEbayItemSuggestion[] = [];
  for (const item of candidatesForLine(line, index)) {
    if (!isEbayBindCandidate(item)) continue;
    const { matchScore, matchKind } = scoreItemAgainstOrderLine(item, order, line);
    if (matchKind === 'recent') continue;
    if (matchKind === 'listingId' || matchKind === 'sku' || matchScore >= minScore) {
      scored.push({ item, matchScore, matchKind });
    }
  }
  return scored.sort((a, b) => b.matchScore - a.matchScore).slice(0, limit);
}

/** Open order lines without suggestion scoring — cheap enough for first paint. */
export function listOpenEbayOrderLines(
  items: InventoryItem[],
  orders: EbayOrderRecord[]
): OpenEbayOrderLine[] {
  const claimed = buildClaimedLineKeys(items, orders);
  const out: OpenEbayOrderLine[] = [];

  for (const order of orders) {
    if (isOrderCancelled(order) || isOrderFullyRefunded(order)) continue;
    const lines = order.lineItems.length ? order.lineItems : [{ sku: null, title: '(no title)' }];
    for (const line of lines) {
      const key = lineItemClaimKey(order.orderId, line);
      if (claimed.has(key)) continue;
      out.push({
        key,
        order,
        lineItem: line,
        payout: getLinePayout(order, line),
        suggestions: [],
      });
    }
  }

  return out.sort((a, b) => (b.order.creationDate || '').localeCompare(a.order.creationDate || ''));
}

export function buildOpenEbayOrderLines(
  items: InventoryItem[],
  orders: EbayOrderRecord[],
  options?: { suggestionLimit?: number }
): OpenEbayOrderLine[] {
  const index = buildBindCandidateIndex(items);
  return listOpenEbayOrderLines(items, orders).map((row) => ({
    ...row,
    suggestions: findItemsForOpenOrderLine(row.lineItem, row.order, index, {
      limit: options?.suggestionLimit ?? 5,
    }),
  }));
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
