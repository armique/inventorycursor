import { InventoryItem, ItemStatus } from '../types';
import type { EbayOrderLineItem, EbayOrderRecord } from '../services/ebayOrderIndex';
import { findMatchingOrdersForItem, type EbayOrderMatch } from './ebayOrderMatch';
import { getLinePayout } from './ebayOrderPayout';

export type OrderLinkSuggestionKind = 'mark_sold' | 'link' | 'reprice';

export interface OrderLinkSuggestion {
  id: string;
  kind: OrderLinkSuggestionKind;
  item: InventoryItem;
  match: EbayOrderMatch;
  currentSellPrice: number | null;
  suggestedSellPrice: number;
  grossAmount: number | null;
  netAmount: number | null;
  feeAmount: number;
  netKnown: boolean;
  priceDelta: number | null;
  totalScore: number;
}

export interface OrderLinkAnalysisResult {
  suggestions: OrderLinkSuggestion[];
  stats: {
    cachedOrders: number;
    inStockItems: number;
    soldEbayItems: number;
    alreadyLinked: number;
    unlinkedSold: number;
    markSoldCandidates: number;
    linkCandidates: number;
    repriceCandidates: number;
    netDataOrders: number;
  };
}

export function lineItemClaimKey(orderId: string, line: EbayOrderLineItem): string {
  const part = (line.sku || line.title || '').trim().toLowerCase();
  return `${orderId}::${part}`;
}

export function isEbayRelatedItem(item: InventoryItem): boolean {
  const platform = (item.platformSold || '').toLowerCase();
  return Boolean(
    item.ebaySku ||
      item.ebayListingId ||
      item.ebayUsername ||
      item.ebayOrderId ||
      platform.includes('ebay')
  );
}

function isSoldEbayCandidate(item: InventoryItem): boolean {
  return (
    (item.status === ItemStatus.SOLD || item.status === ItemStatus.TRADED) && isEbayRelatedItem(item)
  );
}

function isMarkSoldCandidate(item: InventoryItem): boolean {
  if (item.isPC || item.isBundle) return false;
  if (item.status !== ItemStatus.IN_STOCK && item.status !== ItemStatus.ORDERED) return false;
  if (item.ebayOrderId?.trim()) return false;
  return true;
}

function dateProximityBonus(sellDate: string | undefined, orderDate: string | null): number {
  if (!sellDate || !orderDate) return 0;
  const days =
    Math.abs(new Date(`${sellDate}T12:00:00`).getTime() - new Date(`${orderDate}T12:00:00`).getTime()) /
    86400000;
  if (days <= 3) return 40;
  if (days <= 14) return 20;
  if (days <= 45) return 8;
  if (days > 120) return -15;
  return 0;
}

function orderRecencyBonus(orderDate: string | null): number {
  if (!orderDate) return 0;
  const days = (Date.now() - new Date(`${orderDate}T12:00:00`).getTime()) / 86400000;
  if (days <= 7) return 15;
  if (days <= 30) return 8;
  if (days <= 90) return 3;
  return 0;
}

function buildClaimedLineKeys(items: InventoryItem[], orders: EbayOrderRecord[]): Set<string> {
  const ordersById = new Map(orders.map((o) => [o.orderId, o]));
  const claimed = new Set<string>();

  for (const item of items) {
    if (!item.ebayOrderId?.trim()) continue;
    const order = ordersById.get(item.ebayOrderId.trim());
    if (!order) continue;
    const matches = findMatchingOrdersForItem(item, [order], 0);
    const best = matches[0];
    if (best) {
      claimed.add(lineItemClaimKey(best.order.orderId, best.lineItem));
    } else if (order.lineItems.length === 1) {
      claimed.add(lineItemClaimKey(order.orderId, order.lineItems[0]));
    }
  }
  return claimed;
}

function makeSuggestion(
  kind: OrderLinkSuggestionKind,
  item: InventoryItem,
  match: EbayOrderMatch,
  totalScore: number
): OrderLinkSuggestion {
  const payout = getLinePayout(match.order, match.lineItem);
  const current = item.sellPrice ?? null;
  const delta = current != null ? payout.sellPrice - current : null;
  return {
    id: `${kind}:${item.id}:${match.order.orderId}:${lineItemClaimKey(match.order.orderId, match.lineItem)}`,
    kind,
    item,
    match,
    currentSellPrice: current,
    suggestedSellPrice: payout.sellPrice,
    grossAmount: payout.gross,
    netAmount: payout.net,
    feeAmount: payout.fee,
    netKnown: payout.netKnown,
    priceDelta: delta,
    totalScore,
  };
}

function minScoreForMatch(kind: OrderLinkSuggestionKind, matchKind: EbayOrderMatch['matchKind']): number {
  if (matchKind === 'listingId' || matchKind === 'sku') return 40;
  if (kind === 'mark_sold') return 62;
  return 55;
}

const REPRICE_MIN_DELTA = 0.02;

const KIND_SORT: Record<OrderLinkSuggestionKind, number> = {
  mark_sold: 0,
  link: 1,
  reprice: 2,
};

function assignGreedy(
  kind: OrderLinkSuggestionKind,
  items: InventoryItem[],
  orders: EbayOrderRecord[],
  reservedLines: Set<string>,
  suggestions: OrderLinkSuggestion[],
  dateField: 'sellDate' | 'none'
): void {
  const candidateRows: { item: InventoryItem; match: EbayOrderMatch; totalScore: number }[] = [];

  for (const item of items) {
    for (const match of findMatchingOrdersForItem(item, orders)) {
      const key = lineItemClaimKey(match.order.orderId, match.lineItem);
      if (reservedLines.has(key)) continue;
      const dateBonus =
        dateField === 'sellDate'
          ? dateProximityBonus(item.sellDate, match.order.creationDate)
          : orderRecencyBonus(match.order.creationDate);
      candidateRows.push({ item, match, totalScore: match.matchScore + dateBonus });
    }
  }

  candidateRows.sort((a, b) => b.totalScore - a.totalScore);
  const assignedItems = new Set<string>();

  for (const row of candidateRows) {
    if (assignedItems.has(row.item.id)) continue;
    if (row.totalScore < minScoreForMatch(kind, row.match.matchKind)) continue;

    const key = lineItemClaimKey(row.match.order.orderId, row.match.lineItem);
    if (reservedLines.has(key)) continue;

    assignedItems.add(row.item.id);
    reservedLines.add(key);
    suggestions.push(makeSuggestion(kind, row.item, row.match, row.totalScore));
  }
}

export function buildOrderLinkAnalysis(items: InventoryItem[], orders: EbayOrderRecord[]): OrderLinkAnalysisResult {
  const inStockItems = items.filter(isMarkSoldCandidate);
  const soldEbay = items.filter(isSoldEbayCandidate);
  const alreadyLinked = soldEbay.filter((i) => Boolean(i.ebayOrderId?.trim()));
  const unlinkedSold = soldEbay.filter((i) => !i.ebayOrderId?.trim());
  const ordersById = new Map(orders.map((o) => [o.orderId, o]));
  const reservedLines = buildClaimedLineKeys(items, orders);

  const suggestions: OrderLinkSuggestion[] = [];

  // 1) In stock but eBay order exists → mark sold + fill order data.
  assignGreedy('mark_sold', inStockItems, orders, reservedLines, suggestions, 'none');

  // 2) Already sold, missing order id → link order + fix payout.
  assignGreedy('link', unlinkedSold, orders, reservedLines, suggestions, 'sellDate');

  // 3) Already linked but payout differs (e.g. ad fees deducted later).
  for (const item of alreadyLinked) {
    const order = ordersById.get(item.ebayOrderId!.trim());
    if (!order) continue;
    const matches = findMatchingOrdersForItem(item, [order], 0);
    const match =
      matches[0] ??
      (order.lineItems.length === 1
        ? {
            order,
            lineItem: order.lineItems[0],
            matchScore: 500,
            matchKind: 'title' as const,
          }
        : null);
    if (!match) continue;

    const payout = getLinePayout(match.order, match.lineItem);
    const current = item.sellPrice ?? 0;
    const delta = Math.abs(current - payout.sellPrice);
    if (delta < REPRICE_MIN_DELTA) continue;
    if (!payout.netKnown && payout.gross != null && Math.abs(current - payout.gross) < REPRICE_MIN_DELTA) continue;

    suggestions.push(makeSuggestion('reprice', item, match, match.matchScore + 100));
  }

  suggestions.sort((a, b) => {
    const kindDiff = KIND_SORT[a.kind] - KIND_SORT[b.kind];
    if (kindDiff !== 0) return kindDiff;
    return b.totalScore - a.totalScore;
  });

  const markSoldCandidates = suggestions.filter((s) => s.kind === 'mark_sold').length;
  const linkCandidates = suggestions.filter((s) => s.kind === 'link').length;
  const repriceCandidates = suggestions.filter((s) => s.kind === 'reprice').length;

  return {
    suggestions,
    stats: {
      cachedOrders: orders.length,
      inStockItems: inStockItems.length,
      soldEbayItems: soldEbay.length,
      alreadyLinked: alreadyLinked.length,
      unlinkedSold: unlinkedSold.length,
      markSoldCandidates,
      linkCandidates,
      repriceCandidates,
      netDataOrders: orders.filter((o) => o.netTotal != null).length,
    },
  };
}
