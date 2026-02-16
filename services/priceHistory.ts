import { InventoryItem, PriceHistoryEntry } from '../types';

/**
 * If buy or sell price changed, append an entry to priceHistory and return the updated item.
 * Call this when merging an updated item into the list (save from form or inline edit).
 */
export function appendPriceHistoryIfChanged(
  oldItem: InventoryItem | undefined,
  newItem: InventoryItem
): InventoryItem {
  if (!oldItem || oldItem.id !== newItem.id) return newItem;

  const now = new Date().toISOString();
  const entries: PriceHistoryEntry[] = [...(newItem.priceHistory || [])];

  const oldBuy = Number(oldItem.buyPrice);
  const newBuy = Number(newItem.buyPrice);
  if (oldBuy !== newBuy && !Number.isNaN(newBuy)) {
    entries.push({
      date: now,
      type: 'buy',
      price: newBuy,
      previousPrice: Number.isNaN(oldBuy) ? undefined : oldBuy,
    });
  }

  const oldSell = oldItem.sellPrice != null ? Number(oldItem.sellPrice) : undefined;
  const newSell = newItem.sellPrice != null ? Number(newItem.sellPrice) : undefined;
  if (oldSell !== newSell && (newSell != null || oldSell != null)) {
    entries.push({
      date: now,
      type: 'sell',
      price: newSell ?? 0,
      previousPrice: oldSell,
    });
  }

  if (entries.length === (newItem.priceHistory || []).length) return newItem;
  return { ...newItem, priceHistory: entries };
}
