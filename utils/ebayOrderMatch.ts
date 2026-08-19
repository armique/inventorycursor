import type { InventoryItem } from '../types';
import type { EbayOrderLineItem, EbayOrderRecord } from '../services/ebayOrderIndex';
import { scoreListingTitleMatch } from './ebayListingMatch';
import { isOrderCancelled, isOrderFullyRefunded } from './ebayOrderFinancial';
import { itemAlreadyClosedSaleOrder } from './itemSaleCycle';

export type EbayOrderMatchKind = 'listingId' | 'sku' | 'title' | 'recent';

export interface EbayOrderMatch {
  order: EbayOrderRecord;
  lineItem: EbayOrderLineItem;
  matchScore: number;
  matchKind: EbayOrderMatchKind;
  /** Days since order creation (null if unknown). */
  orderAgeDays?: number | null;
}

/** Prefer very recent sales when inventory names are short / slightly off. */
export function orderRecencyBoost(creationDate: string | null | undefined): number {
  if (!creationDate) return 0;
  const days = (Date.now() - new Date(`${creationDate.slice(0, 10)}T12:00:00`).getTime()) / 86400000;
  if (Number.isNaN(days)) return 0;
  if (days < 0) return 120;
  if (days <= 1) return 160;
  if (days <= 3) return 120;
  if (days <= 7) return 80;
  if (days <= 21) return 45;
  if (days <= 45) return 15;
  if (days > 180) return -30;
  return 0;
}

function orderAgeDays(creationDate: string | null | undefined): number | null {
  if (!creationDate) return null;
  const days = (Date.now() - new Date(`${creationDate.slice(0, 10)}T12:00:00`).getTime()) / 86400000;
  return Number.isNaN(days) ? null : Math.max(0, Math.round(days));
}

function orderTimeMs(creationDate: string | null | undefined): number {
  if (!creationDate) return 0;
  const t = new Date(`${creationDate.slice(0, 10)}T12:00:00`).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function annotateLineMatch(
  item: InventoryItem,
  order: EbayOrderRecord,
  line: EbayOrderLineItem
): Pick<EbayOrderMatch, 'matchScore' | 'matchKind'> {
  const recency = orderRecencyBoost(order.creationDate);

  if (item.ebayListingId && line.listingId && item.ebayListingId === line.listingId) {
    return { matchScore: 1000 + Math.min(recency, 50), matchKind: 'listingId' };
  }
  if (item.ebaySku && line.sku && item.ebaySku.trim().toLowerCase() === line.sku.trim().toLowerCase()) {
    return { matchScore: 900 + Math.min(recency, 50), matchKind: 'sku' };
  }
  if (item.name?.trim()) {
    const base = scoreListingTitleMatch(item.name, line.title, line.sku || undefined, item.ebaySku);
    if (base >= 40) {
      return { matchScore: base + recency, matchKind: 'title' };
    }
  }
  // No strong name hit — still listable as a recent order for manual pick.
  return {
    matchScore: Math.max(0, recency),
    matchKind: 'recent',
  };
}

/** Score one inventory row against a specific eBay order line. */
export function scoreItemAgainstOrderLine(
  item: InventoryItem,
  order: EbayOrderRecord,
  line: EbayOrderLineItem
): Pick<EbayOrderMatch, 'matchScore' | 'matchKind'> {
  return annotateLineMatch(item, order, line);
}

/**
 * Recent order line-items for Mark-as-sold: newest first so the seller can tap the right one.
 * Match badges are hints only — ranking is by order date.
 */
export function listRecentEbayOrdersForSale(
  item: InventoryItem,
  orders: EbayOrderRecord[],
  options?: { days?: number; limit?: number }
): EbayOrderMatch[] {
  const days = options?.days ?? 45;
  const limit = options?.limit ?? 12;
  const cutoff = Date.now() - days * 86400000;

  const recent = orders
    .filter((o) => {
      const t = orderTimeMs(o.creationDate);
      return t >= cutoff || !o.creationDate;
    })
    .sort((a, b) => orderTimeMs(b.creationDate) - orderTimeMs(a.creationDate));

  // If the window is empty (stale cache), fall back to newest orders overall.
  const pool =
    recent.length > 0
      ? recent
      : [...orders].sort((a, b) => orderTimeMs(b.creationDate) - orderTimeMs(a.creationDate));

  const results: EbayOrderMatch[] = [];
  for (const order of pool) {
    if (skipOrderForNewSale(item, order)) continue;
    const age = orderAgeDays(order.creationDate);
    for (const line of order.lineItems) {
      const ann = annotateLineMatch(item, order, line);
      results.push({
        order,
        lineItem: line,
        matchScore: ann.matchScore,
        matchKind: ann.matchKind,
        orderAgeDays: age,
      });
      if (results.length >= limit) return results;
    }
  }
  return results;
}

function skipOrderForNewSale(item: InventoryItem, order: EbayOrderRecord): boolean {
  if (itemAlreadyClosedSaleOrder(item, order.orderId)) return true;
  if (isOrderFullyRefunded(order) || isOrderCancelled(order)) return true;
  return false;
}

/** Find cached orders whose line items likely correspond to this inventory item (score-ranked). */
export function findMatchingOrdersForItem(
  item: InventoryItem,
  orders: EbayOrderRecord[],
  minScore = 40
): EbayOrderMatch[] {
  const results: EbayOrderMatch[] = [];

  for (const order of orders) {
    if (skipOrderForNewSale(item, order)) continue;
    const recency = orderRecencyBoost(order.creationDate);
    const age = orderAgeDays(order.creationDate);
    for (const line of order.lineItems) {
      if (item.ebayListingId && line.listingId && item.ebayListingId === line.listingId) {
        results.push({
          order,
          lineItem: line,
          matchScore: 1000 + Math.min(recency, 50),
          matchKind: 'listingId',
          orderAgeDays: age,
        });
        continue;
      }
      if (item.ebaySku && line.sku && item.ebaySku.trim().toLowerCase() === line.sku.trim().toLowerCase()) {
        results.push({
          order,
          lineItem: line,
          matchScore: 900 + Math.min(recency, 50),
          matchKind: 'sku',
          orderAgeDays: age,
        });
        continue;
      }
      if (!item.name?.trim()) continue;
      const base = scoreListingTitleMatch(item.name, line.title, line.sku || undefined, item.ebaySku);
      if (base <= 0) continue;
      const score = base + recency;
      const threshold = recency >= 80 ? Math.min(minScore, 28) : minScore;
      if (score >= threshold || (recency >= 120 && base >= 20)) {
        results.push({ order, lineItem: line, matchScore: score, matchKind: 'title', orderAgeDays: age });
      }
    }
  }

  return results.sort((a, b) => b.matchScore - a.matchScore);
}

function saleLineKey(orderId: string, line: EbayOrderLineItem): string {
  return `${orderId}::${(line.sku || line.title || '').trim().toLowerCase()}`;
}

/**
 * Mark-as-sold list: name/SKU/listing matches first (so a Toshiba 1TB HDD
 * surfaces immediately), then other recent orders for a manual pick.
 */
export function listEbayOrdersForItemSale(
  item: InventoryItem,
  orders: EbayOrderRecord[],
  options?: { days?: number; limit?: number; claimedKeys?: Iterable<string> }
): EbayOrderMatch[] {
  const limit = options?.limit ?? 12;
  const claimed = new Set(
    [...(options?.claimedKeys || [])].map((k) => String(k).trim().toLowerCase()).filter(Boolean)
  );
  if (item.ebayOrderLineKey) claimed.add(item.ebayOrderLineKey.trim().toLowerCase());

  const unused = (match: EbayOrderMatch) => {
    const key = saleLineKey(match.order.orderId, match.lineItem);
    if (claimed.has(key)) return false;
    if (item.ebayOrderId && match.order.orderId === item.ebayOrderId) return false;
    return true;
  };

  const ranked = findMatchingOrdersForItem(item, orders, 28).filter(unused);
  const recent = listRecentEbayOrdersForSale(item, orders, {
    days: options?.days ?? 90,
    limit: Math.max(limit * 3, 24),
  }).filter(unused);

  const seen = new Set<string>();
  const out: EbayOrderMatch[] = [];
  for (const match of [...ranked, ...recent]) {
    const key = saleLineKey(match.order.orderId, match.lineItem);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(match);
    if (out.length >= limit) break;
  }
  return out;
}

export function isStrongEbayOrderMatch(match: EbayOrderMatch): boolean {
  return match.matchKind !== 'recent' && match.matchScore >= 40;
}
