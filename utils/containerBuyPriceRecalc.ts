import type { InventoryItem } from '../types';
import {
  splitBulkImportCosts,
  type BulkCostSplitMode,
} from './bulkImportCostSplit';

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Children linked by componentIds or parentContainerId (same as Quick Bundle). */
export function getContainerChildParts(
  container: InventoryItem,
  allItems: InventoryItem[]
): InventoryItem[] {
  return allItems.filter(
    (i) =>
      i.id !== container.id &&
      ((container.componentIds || []).includes(i.id) || i.parentContainerId === container.id)
  );
}

export function resolveContainerLotTotal(
  container: InventoryItem,
  children: InventoryItem[],
  /** Prefer this when resplitting after add — usually the pre-add container buyPrice. */
  preferredTotal?: number
): number {
  if (preferredTotal != null && Number.isFinite(preferredTotal) && preferredTotal > 0) {
    return roundMoney(preferredTotal);
  }
  const parentBuy = Number(container.buyPrice) || 0;
  if (parentBuy > 0) return roundMoney(parentBuy);
  return roundMoney(children.reduce((s, c) => s + (Number(c.buyPrice) || 0), 0));
}

/**
 * Redistribute `totalCost` across container children; parent buyPrice becomes the lot total.
 */
export function resplitContainerBuyPrices(params: {
  container: InventoryItem;
  items: InventoryItem[];
  totalCost?: number;
  mode?: BulkCostSplitMode;
  lockedItemIds?: Set<string>;
}): { parent: InventoryItem; children: InventoryItem[]; totalCost: number } {
  const mode = params.mode || 'SMART';
  const children = getContainerChildParts(params.container, params.items);
  const totalCost = resolveContainerLotTotal(params.container, children, params.totalCost);

  if (children.length === 0) {
    return {
      parent: { ...params.container, buyPrice: totalCost },
      children: [],
      totalCost,
    };
  }

  const costs = splitBulkImportCosts(
    children.map((c) => ({
      id: c.id,
      name: c.name,
      category: c.category,
      subCategory: c.subCategory,
      isDefective: c.isDefective,
      manualCost: params.lockedItemIds?.has(c.id) ? Number(c.buyPrice) || 0 : undefined,
    })),
    totalCost,
    mode
  );

  const patchedChildren = children.map((c) => ({
    ...c,
    buyPrice: costs[c.id] ?? roundMoney(Number(c.buyPrice) || 0),
  }));
  const sum = roundMoney(patchedChildren.reduce((s, c) => s + (Number(c.buyPrice) || 0), 0));

  return {
    parent: {
      ...params.container,
      buyPrice: sum,
      componentIds: patchedChildren.map((c) => c.id),
    },
    children: patchedChildren,
    totalCost: sum,
  };
}
