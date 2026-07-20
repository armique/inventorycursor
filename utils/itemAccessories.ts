import type { InventoryItem } from '../types';
import { getChildren } from '../services/financialAggregation';

/** Motherboard rows can carry an IO shield flag. */
export function isMotherboardLike(item: {
  category?: string;
  subCategory?: string;
  name?: string;
  isBundle?: boolean;
  isPC?: boolean;
}): boolean {
  if (item.isBundle || item.isPC) return false;
  const cat = `${item.category || ''} ${item.subCategory || ''}`.toLowerCase();
  if (cat.includes('motherboard') || cat.includes('mainboard')) return true;
  return /\b(motherboard|mainboard|mobo)\b/i.test(item.name || '');
}

export type ProductCardAccessoryHints = {
  hasOVP: boolean;
  hasIOShield: boolean;
};

/**
 * Resolve OVP / IO-Blende for product cards.
 * For PC/Bundle parents, OR together parent flags with children (e.g. mobo has IO shield).
 */
export function resolveProductCardAccessoryHints(
  item: InventoryItem,
  allItems?: InventoryItem[] | null
): ProductCardAccessoryHints {
  let hasOVP = item.hasOVP === true;
  let hasIOShield = item.hasIOShield === true;

  const isContainer =
    item.isPC ||
    item.isBundle ||
    item.category === 'PC' ||
    item.category === 'Bundle' ||
    item.category === 'Mixed Bundle' ||
    (item.componentIds?.length ?? 0) > 0;

  if (isContainer && allItems?.length) {
    const children = getChildren(item, allItems);
    for (const child of children) {
      if (child.hasOVP === true) hasOVP = true;
      if (child.hasIOShield === true) hasIOShield = true;
    }
  }

  return { hasOVP, hasIOShield };
}
