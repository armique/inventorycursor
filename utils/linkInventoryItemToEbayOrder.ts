import type { InventoryItem, TaxMode } from '../types';
import { orderHasFeeBreakdown } from '../services/ebayOrderIndex';
import { applyEbayOrderMatchToItem } from './applyEbayOrderMatch';
import type { EbayOrderMatch } from './ebayOrderMatch';
import { mergeHubOrderLines, pickHubLinesForItem } from './hubOrderProceeds';
import { applyHubPayoutBreakdownToSoldItem } from './replaceItemSaleProceedsFromHub';

/**
 * Link an inventory row to an eBay order.
 *
 * 1. Mark sold (when in stock) and bind order id, buyer, platform.
 * 2. When the order cache has a fee breakdown, stamp the full split onto the item
 *    (Gesamtbetrag, label, ads, eBay fees, Bestelleinnahmen) so the Sell cell matches
 *    the real eBay order.
 */
export function linkInventoryItemToEbayOrder(
  item: InventoryItem,
  match: EbayOrderMatch,
  taxMode: TaxMode,
  allItems?: InventoryItem[]
): InventoryItem {
  const linked = applyEbayOrderMatchToItem(item, match, taxMode);
  const order = orderHasFeeBreakdown(match.order) ? match.order : null;
  if (!order || !orderHasFeeBreakdown(order)) return linked;

  const lines = allItems?.length
    ? pickHubLinesForItem(order, linked, allItems)
    : [match.lineItem];
  const line = mergeHubOrderLines(lines);
  return applyHubPayoutBreakdownToSoldItem(linked, order, line, taxMode, allItems);
}
