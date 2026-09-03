/**
 * Resolve container children from every direction (Part C Rule 8).
 *
 * Never use `a || b` on two arrays — an empty array is truthy and strands reverse links.
 */
import type { InventoryItem } from '../types';

/** Union of componentIds / child_item_ids / legacy component lists + reverse parentContainerId. */
export function childIdsOf(
  container: Pick<InventoryItem, 'id' | 'componentIds'> & { childItemIds?: string[] },
  allItems: InventoryItem[]
): string[] {
  const ids = new Set<string>();
  for (const id of container.componentIds || []) {
    if (id) ids.add(id);
  }
  for (const id of container.childItemIds || []) {
    if (id) ids.add(id);
  }
  for (const item of allItems) {
    if (!item?.id) continue;
    if (item.parentContainerId === container.id) ids.add(item.id);
  }
  ids.delete(container.id);
  return Array.from(ids);
}

export function childrenOf(container: InventoryItem, allItems: InventoryItem[]): InventoryItem[] {
  const byId = new Map(allItems.map((i) => [i.id, i]));
  return childIdsOf(container, allItems)
    .map((id) => byId.get(id))
    .filter((x): x is InventoryItem => Boolean(x));
}
