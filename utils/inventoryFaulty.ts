import type { InventoryItem } from '../types';
import { getChildren, type InventoryLookup } from '../services/financialAggregation';
import { isInventoryContainer } from './containerMembership';

export function inventoryItemIsFaulty(item: Pick<InventoryItem, 'isDefective'>): boolean {
  return Boolean(item.isDefective);
}

export type FaultyRowMeta = {
  selfFaulty: boolean;
  faultyChildCount: number;
  showRowIndicator: boolean;
};

export function getFaultyRowMeta(
  item: InventoryItem,
  items: InventoryItem[],
  lookup: InventoryLookup,
): FaultyRowMeta {
  const selfFaulty = inventoryItemIsFaulty(item);
  let faultyChildCount = 0;
  if (isInventoryContainer(item)) {
    faultyChildCount = getChildren(item, items, lookup).filter(inventoryItemIsFaulty).length;
  }
  return {
    selfFaulty,
    faultyChildCount,
    showRowIndicator: selfFaulty || faultyChildCount > 0,
  };
}
