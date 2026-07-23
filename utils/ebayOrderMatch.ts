import type { InventoryItem } from '../types';
import type { EbayOrderLineItem, EbayOrderRecord } from '../services/ebayOrderIndex';
import { scoreListingTitleMatch } from './ebayListingMatch';

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

/** Find cached orders whose line items likely correspond to this inventory item (score-ranked). */
export function findMatchingOrdersForItem(
  item: InventoryItem,
  orders: EbayOrderRecord[],
  minScore = 40
): EbayOrderMatch[] {
  const results: EbayOrderMatch[] = [];

  for (const order of orders) {
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
