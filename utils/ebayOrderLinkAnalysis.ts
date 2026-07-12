import { InventoryItem, ItemStatus } from '../types';
import type { EbayOrderLineItem, EbayOrderRecord } from '../services/ebayOrderIndex';
import { findMatchingOrdersForItem, type EbayOrderMatch } from './ebayOrderMatch';
import { getLinePayout } from './ebayOrderPayout';

export type OrderLinkSuggestionKind = 'link' | 'reprice';

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
    soldEbayItems: number;
    alreadyLinked: number;
    unlinkedSold: number;
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

function dateProximityBonus(sellDate: string | undefined, orderDate: string | null): number {
  if (!sellDate || !orderDate) return 0;
  const days = Math.abs(new Date(`${sellDate}T12:00:00`).getTime() - new Date(`${orderDate}T12:00:00`).getTime()) / 86400000;
  if (days <= 3) return 40;
  if (days <= 14) return 20;
  if (days <= 45) return 8;
  if (days > 120) return -15;
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

const REPRICE_MIN_DELTA = 0.02;

export function buildOrderLinkAnalysis(items: InventoryItem[], orders: EbayOrderRecord[]): OrderLinkAnalysisResult {
  const soldEbay = items.filter(isSoldEbayCandidate);
  const alreadyLinked = soldEbay.filter((i) => Boolean(i.ebayOrderId?.trim()));
  const unlinkedSold = soldEbay.filter((i) => !i.ebayOrderId?.trim());
  const ordersById = new Map(orders.map((o) => [o.orderId, o]));
  const reservedLines = buildClaimedLineKeys(items, orders);

  const suggestions: OrderLinkSuggestion[] = [];

  // Reprice: already linked, cached order has payout data that differs from stored sell price.
  for (const item of alreadyLinked) {
    const order = ordersById.get(item.ebayOrderId!.trim());
    if (!order) continue;
    const matches = findMatchingOrdersForItem(item, [order], 0);
    const match = matches[0] ?? (order.lineItems.length === 1
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
    // Only suggest reprice when we know net, or gross clearly differs (early screenshot price vs API gross).
    if (!payout.netKnown && payout.gross != null && Math.abs(current - payout.gross) < REPRICE_MIN_DELTA) continue;

    suggestions.push(makeSuggestion('reprice', item, match, match.matchScore + 100));
  }

  // Link: sold on eBay but missing order id — best order line per item, one line claimed once.
  const candidateRows: { item: InventoryItem; match: EbayOrderMatch; totalScore: number }[] = [];
  for (const item of unlinkedSold) {
    for (const match of findMatchingOrdersForItem(item, orders)) {
      const key = lineItemClaimKey(match.order.orderId, match.lineItem);
      if (reservedLines.has(key)) continue;
      const totalScore = match.matchScore + dateProximityBonus(item.sellDate, match.order.creationDate);
      candidateRows.push({ item, match, totalScore });
    }
  }

  candidateRows.sort((a, b) => b.totalScore - a.totalScore);
  const assignedItems = new Set<string>();

  for (const row of candidateRows) {
    if (assignedItems.has(row.item.id)) continue;
    const minScore = row.match.matchKind === 'title' ? 55 : 40;
    if (row.totalScore < minScore) continue;

    const key = lineItemClaimKey(row.match.order.orderId, row.match.lineItem);
    if (reservedLines.has(key)) continue;

    assignedItems.add(row.item.id);
    reservedLines.add(key);
    suggestions.push(makeSuggestion('link', row.item, row.match, row.totalScore));
  }

  suggestions.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'link' ? -1 : 1;
    return b.totalScore - a.totalScore;
  });

  return {
    suggestions,
    stats: {
      cachedOrders: orders.length,
      soldEbayItems: soldEbay.length,
      alreadyLinked: alreadyLinked.length,
      unlinkedSold: unlinkedSold.length,
      repriceCandidates: suggestions.filter((s) => s.kind === 'reprice').length,
      netDataOrders: orders.filter((o) => o.netTotal != null).length,
    },
  };
}
