import { InventoryItem, ItemStatus } from '../types';

export function buildItemsById(items: InventoryItem[]): Map<string, InventoryItem> {
  return new Map(items.map((i) => [i.id, i]));
}

/** Items received when this line was traded away (outgoing trade). */
export function resolveTradeReceivedItems(
  item: InventoryItem,
  itemsById: Map<string, InventoryItem>
): InventoryItem[] {
  if (item.status !== ItemStatus.TRADED || !item.tradedForIds?.length) return [];
  return item.tradedForIds
    .map((id) => itemsById.get(id))
    .filter((x): x is InventoryItem => !!x);
}

/** Original item this row was acquired from in a trade (incoming). */
export function resolveTradeSourceItem(
  item: InventoryItem,
  itemsById: Map<string, InventoryItem>
): InventoryItem | undefined {
  if (!item.tradedFromId) return undefined;
  return itemsById.get(item.tradedFromId);
}

export function formatTradeItemList(names: string[], max = 2): string {
  if (names.length === 0) return '';
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} +${names.length - max} more`;
}
