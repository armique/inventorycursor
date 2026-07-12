import type { InventoryItem } from '../types';
import type { EbayOrderLineItem, EbayOrderRecord } from '../services/ebayOrderIndex';
import { scoreListingTitleMatch } from './ebayListingMatch';

export type EbayOrderMatchKind = 'listingId' | 'sku' | 'title';

export interface EbayOrderMatch {
  order: EbayOrderRecord;
  lineItem: EbayOrderLineItem;
  matchScore: number;
  matchKind: EbayOrderMatchKind;
}

/** Find cached orders whose line items likely correspond to this inventory item. */
export function findMatchingOrdersForItem(
  item: InventoryItem,
  orders: EbayOrderRecord[],
  minScore = 40
): EbayOrderMatch[] {
  const results: EbayOrderMatch[] = [];

  for (const order of orders) {
    for (const line of order.lineItems) {
      if (item.ebayListingId && line.listingId && item.ebayListingId === line.listingId) {
        results.push({ order, lineItem: line, matchScore: 1000, matchKind: 'listingId' });
        continue;
      }
      if (item.ebaySku && line.sku && item.ebaySku.trim().toLowerCase() === line.sku.trim().toLowerCase()) {
        results.push({ order, lineItem: line, matchScore: 900, matchKind: 'sku' });
        continue;
      }
      if (!item.name?.trim()) continue;
      const score = scoreListingTitleMatch(item.name, line.title, line.sku || undefined, item.ebaySku);
      if (score >= minScore) {
        results.push({ order, lineItem: line, matchScore: score, matchKind: 'title' });
      }
    }
  }

  return results.sort((a, b) => b.matchScore - a.matchScore);
}
