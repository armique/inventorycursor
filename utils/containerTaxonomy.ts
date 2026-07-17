import type { InventoryItem } from '../types';

/** Normalize legacy Lot Bundle / Custom Built PC into new taxonomy. */
export function migrateContainerItem(item: InventoryItem): InventoryItem {
  const next = { ...item };

  const isLegacyOrMixed =
    next.category === 'Mixed Bundle' ||
    next.subCategory === 'Lot Bundle' ||
    (next.isBundle && (next.vendor === 'Lot Bundle' || next.vendor === 'Mixed Bundle'));

  if (isLegacyOrMixed && !next.isPC) {
    next.category = 'Mixed Bundle';
    delete next.subCategory;
    next.isBundle = true;
    next.isPC = false;
    if (!next.vendor || next.vendor === 'Lot Bundle') next.vendor = 'Mixed Bundle';
    return next;
  }

  if (next.isPC || next.category === 'PC') {
    next.category = 'PC';
    next.isPC = true;
    next.isBundle = false;
    delete next.subCategory;
    return next;
  }

  if (next.isBundle || next.category === 'Bundle') {
    next.category = 'Bundle';
    next.isBundle = true;
    next.isPC = false;
    delete next.subCategory;
    return next;
  }

  return next;
}

export function migrateCategoriesRecord(
  cats: Record<string, string[]>
): Record<string, string[]> {
  const next: Record<string, string[]> = { ...cats };
  next.PC = [];
  next.Bundle = [];
  next['Mixed Bundle'] = [];
  return next;
}

export function isMixedBundleContainer(item: InventoryItem | undefined | null): boolean {
  if (!item) return false;
  return (
    item.category === 'Mixed Bundle' ||
    item.subCategory === 'Lot Bundle' ||
    (item.isBundle === true &&
      (item.vendor === 'Mixed Bundle' || item.vendor === 'Lot Bundle') &&
      item.category !== 'Bundle')
  );
}
