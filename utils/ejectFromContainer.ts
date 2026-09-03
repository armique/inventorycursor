/**
 * Take a part out of a container (Part C Rules 6–7).
 * Pure: returns the item patches; caller persists through handleUpdate.
 */
import { InventoryItem, ItemStatus } from '../types';
import { roundMoney } from '../services/financialAggregation';
import { childIdsOf, childrenOf } from './childIdsOf';
import { isRealizedDisposal } from './itemDisposition';

export type EjectPlan = {
  updates: InventoryItem[];
  deleteIds: string[];
};

function walkAncestors(
  start: InventoryItem,
  all: InventoryItem[],
  visit: (container: InventoryItem) => InventoryItem | null
): InventoryItem[] {
  const out: InventoryItem[] = [];
  const seen = new Set<string>();
  let current: InventoryItem | undefined = start;
  while (current?.parentContainerId) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    const parent = all.find((i) => i.id === current!.parentContainerId);
    if (!parent) break;
    const next = visit(parent);
    if (next) {
      out.push(next);
      current = next;
    } else {
      current = parent;
    }
  }
  return out;
}

/**
 * Eject `child` from `parent`. Container shrinks by exactly the child's buyPrice.
 * Last part: delete empty shell if residue is 0; keep standalone row if residue > 0.
 * Nested containers: ancestors adjust by the change in the inner container's own value.
 */
export function planEjectFromContainer(
  child: InventoryItem,
  parent: InventoryItem,
  allItems: InventoryItem[]
): EjectPlan {
  const childShare = roundMoney(Number(child.buyPrice) || 0);
  const parentBefore = roundMoney(Number(parent.buyPrice) || 0);
  const remainingIds = childIdsOf(parent, allItems).filter((id) => id !== child.id);
  const remaining = remainingIds
    .map((id) => allItems.find((i) => i.id === id))
    .filter((x): x is InventoryItem => Boolean(x));

  const restoreAsSold = isRealizedDisposal(parent) || parent.subCategory === 'Retro Bundle';
  const restored: InventoryItem = restoreAsSold
    ? { ...child, parentContainerId: undefined, isSplitRemainder: undefined, status: ItemStatus.SOLD }
    : {
        ...child,
        parentContainerId: undefined,
        isSplitRemainder: undefined,
        status: ItemStatus.IN_STOCK,
        sellPrice: undefined,
        sellDate: undefined,
        profit: undefined,
        paymentType: undefined,
        platformSold: undefined,
        containerSoldDate: undefined,
      };

  const parentAfter = roundMoney(Math.max(0, parentBefore - childShare));
  const innerDelta = roundMoney(parentAfter - parentBefore); // negative or zero

  if (remaining.length === 0) {
    if (parentAfter > 0) {
      const kept: InventoryItem = {
        ...parent,
        buyPrice: parentAfter,
        componentIds: [],
        isBundle: false,
        isPC: false,
      };
      const ancestors = walkAncestors(parent, allItems, (anc) => {
        const before = roundMoney(Number(anc.buyPrice) || 0);
        return { ...anc, buyPrice: roundMoney(before + innerDelta) };
      });
      return { updates: [restored, kept, ...ancestors], deleteIds: [] };
    }
    const ancestors = walkAncestors(parent, allItems, (anc) => {
      const before = roundMoney(Number(anc.buyPrice) || 0);
      const nextIds = childIdsOf(anc, allItems).filter((id) => id !== parent.id);
      return {
        ...anc,
        buyPrice: roundMoney(before + innerDelta),
        componentIds: nextIds,
      };
    });
    return { updates: [restored, ...ancestors], deleteIds: [parent.id] };
  }

  const sellTotal = restoreAsSold
    ? roundMoney(remaining.reduce((s, i) => s + (Number(i.sellPrice) || 0), 0))
    : undefined;

  const updatedParent: InventoryItem = {
    ...parent,
    componentIds: remaining.map((p) => p.id),
    buyPrice: parentAfter,
    ...(sellTotal != null ? { sellPrice: sellTotal } : {}),
  };

  const ancestors = walkAncestors(updatedParent, allItems, (anc) => {
    const before = roundMoney(Number(anc.buyPrice) || 0);
    return { ...anc, buyPrice: roundMoney(before + innerDelta) };
  });

  return { updates: [updatedParent, restored, ...ancestors], deleteIds: [] };
}

export function containerWorthAtLeastContents(container: InventoryItem, allItems: InventoryItem[]): boolean {
  const contents = childrenOf(container, allItems).reduce((s, c) => s + (Number(c.buyPrice) || 0), 0);
  return roundMoney(Number(container.buyPrice) || 0) + 1e-9 >= roundMoney(contents);
}
