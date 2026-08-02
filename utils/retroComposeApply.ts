/**
 * Historical / retro PC-bundle compose: reclaim parts from older shells so one
 * sale cannot appear as two sold containers sharing the same componentIds.
 */

import type { InventoryItem } from '../types';
import { isOrphanSoldContainerShell } from '../services/financialAggregation';
import { isSoldOrTradedOnly } from './itemDisposition';

/**
 * After composing a new container, strip claimed part ids from every other
 * PC/bundle. Sold shells left with zero components are returned in `deleteIds`.
 */
export function reclaimComponentsFromOtherContainers(
  items: InventoryItem[],
  claimedComponentIds: string[],
  newContainerId: string
): { nextItems: InventoryItem[]; deleteIds: string[] } {
  const claim = new Set(claimedComponentIds.filter(Boolean));
  if (claim.size === 0) return { nextItems: items, deleteIds: [] };

  const deleteIds: string[] = [];
  const nextItems = items.map((row) => {
    if (row.id === newContainerId) return row;
    if (!row.isPC && !row.isBundle) return row;
    const ids = row.componentIds || [];
    if (!ids.some((id) => claim.has(id))) return row;
    const nextIds = ids.filter((id) => !claim.has(id));
    if (nextIds.length === 0 && isSoldOrTradedOnly(row)) {
      deleteIds.push(row.id);
    }
    return { ...row, componentIds: nextIds };
  });

  return { nextItems, deleteIds };
}

/**
 * Merge a freshly built retro container + its parts into inventory, reclaiming
 * those parts from any older shells (and dropping emptied sold shells).
 */
export function applyRetroComposeToInventory(
  items: InventoryItem[],
  bundle: InventoryItem,
  updatedComponents: InventoryItem[]
): { nextItems: InventoryItem[]; deleteIds: string[] } {
  const byId = new Map(items.map((i) => [i.id, i]));
  byId.set(bundle.id, bundle);
  for (const c of updatedComponents) byId.set(c.id, c);
  const merged = Array.from(byId.values());

  const claimed = bundle.componentIds?.length
    ? bundle.componentIds
    : updatedComponents.map((c) => c.id);
  const { nextItems, deleteIds } = reclaimComponentsFromOtherContainers(
    merged,
    claimed,
    bundle.id
  );

  return {
    nextItems: nextItems.filter((i) => !deleteIds.includes(i.id)),
    deleteIds,
  };
}

/** Ids of orphan sold PC/bundle shells that should be removed from inventory. */
export function findOrphanSoldContainerShellIds(items: InventoryItem[]): string[] {
  return items.filter((i) => isOrphanSoldContainerShell(i, items)).map((i) => i.id);
}

export { isOrphanSoldContainerShell };
