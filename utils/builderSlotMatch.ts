import { InventoryItem, ItemStatus } from '../types';

const MOTHERBOARD_NAME_PATTERN =
  /\b(mainboard|motherboard|mobo|chipset|form\s*factor|io[\s-]*shield|(?:a|b|h|x|z)\d{2,4}[a-z0-9-]*)\b/i;

export type BuilderSlotDef = {
  id: string;
  category: string;
};

export function isMotherboardItem(item: InventoryItem): boolean {
  return (
    item.subCategory === 'Motherboards' ||
    item.category === 'Motherboards' ||
    MOTHERBOARD_NAME_PATTERN.test(item.name || '')
  );
}

export function isProcessorItem(item: InventoryItem): boolean {
  return (
    item.subCategory === 'Processors' ||
    item.category === 'Processors' ||
    /\b(intel core|ryzen|threadripper|xeon|pentium|celeron|cpu|prozessor)\b/i.test(item.name || '')
  );
}

export function isGraphicsCardItem(item: InventoryItem): boolean {
  return (
    item.subCategory === 'Graphics Cards' ||
    item.category === 'Graphics Cards' ||
    /\b(rtx|gtx|radeon|rx\s?\d{3,5}|graphics card|grafikkarte)\b/i.test(item.name || '')
  );
}

export function isEligibleForBuilderPicker(
  item: InventoryItem,
  opts: { editId: string | null; bundleMode: boolean; isLotBundle: boolean }
): boolean {
  if (item.isDefective && !opts.isLotBundle) return false;
  if ((item.category === 'Bundle' && item.subCategory === 'PC Bundle') || item.category === 'PC Bundle') {
    return false;
  }
  if (item.isPC || item.isBundle) return false;

  if (item.status === ItemStatus.IN_STOCK) return true;
  if (opts.editId && item.parentContainerId === opts.editId) return true;
  if (opts.bundleMode && item.status === ItemStatus.ORDERED) return true;
  return false;
}

export function itemMatchesBuilderSlot(
  item: InventoryItem,
  slot: BuilderSlotDef,
  opts: {
    bundleMode: boolean;
    assignedInSlot?: InventoryItem[];
  }
): boolean {
  if (slot.id === 'FANS') {
    const isExplicitFan =
      item.category === 'Fans' || item.subCategory === 'Fans' || item.subCategory === 'Case Fans';
    const isCooling = item.category === 'Cooling' || item.subCategory === 'Cooling';
    return isExplicitFan || isCooling;
  }

  if (slot.id === 'MISC') return true;

  const slotCat = slot.category;
  if (item.category === slotCat || item.subCategory === slotCat) return true;

  if (opts.bundleMode) {
    if (slot.id === 'MOBO' && isMotherboardItem(item)) return true;
    if (slot.id === 'CPU' && isProcessorItem(item)) return true;
    if (slot.id === 'GPU' && isGraphicsCardItem(item)) return true;

    const assigned = opts.assignedInSlot || [];
    if (assigned.length > 0) {
      const ref = assigned[0];
      if (ref.subCategory && item.subCategory === ref.subCategory) return true;
      if (ref.category === item.category && ref.subCategory === item.subCategory) return true;
    }
  }

  return false;
}

export function findBuilderSlotForComponent(
  comp: InventoryItem,
  slots: BuilderSlotDef[]
): BuilderSlotDef | undefined {
  const direct = slots.find((s) => s.category === comp.category || s.category === comp.subCategory);
  if (direct) return direct;

  if (isMotherboardItem(comp)) return slots.find((s) => s.id === 'MOBO');
  if (isProcessorItem(comp)) return slots.find((s) => s.id === 'CPU');
  if (isGraphicsCardItem(comp)) return slots.find((s) => s.id === 'GPU');

  return undefined;
}

export function itemMatchesBuilderSearch(item: InventoryItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const specText = item.specs ? Object.values(item.specs).filter(Boolean).join(' ') : '';
  const haystack = [
    item.name,
    item.category,
    item.subCategory,
    item.vendor,
    item.comment1,
    item.comment2,
    item.ebaySku,
    specText,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

export function getBuilderPickerBlockReason(
  item: InventoryItem,
  opts: {
    editId: string | null;
    bundleMode: boolean;
    isLotBundle: boolean;
    containersById: Map<string, InventoryItem>;
  }
): string | null {
  if (item.isDefective && !opts.isLotBundle) {
    return 'Marked defective — only lot bundles can include faulty parts';
  }

  if ((item.category === 'Bundle' && item.subCategory === 'PC Bundle') || item.category === 'PC Bundle') {
    return 'PC bundle — cannot add as a part';
  }
  if (item.isPC) return 'PC build — cannot add as a part';
  if (item.isBundle) return 'Bundle container — cannot add as a part';

  if (opts.editId && item.parentContainerId === opts.editId) return null;
  if (item.status === ItemStatus.IN_STOCK) return null;
  if (opts.bundleMode && item.status === ItemStatus.ORDERED) return null;

  if (item.status === ItemStatus.IN_COMPOSITION && item.parentContainerId) {
    const parent = opts.containersById.get(item.parentContainerId);
    const label = parent?.name?.trim() || 'Another build/bundle';
    if (parent?.isBundle && parent.subCategory === 'Lot Bundle') {
      return `Already in lot bundle: ${label}`;
    }
    if (parent?.isBundle) return `Already in bundle: ${label}`;
    if (parent?.isPC) return `Already in PC build: ${label}`;
    return `Already in use: ${label}`;
  }

  if (item.status === ItemStatus.SOLD) return 'Sold — revert the sale first';
  if (item.status === ItemStatus.TRADED) return 'Traded away';
  if (item.status === ItemStatus.IN_COMPOSITION) return 'Already in another build/bundle';

  return `Not available (${item.status})`;
}

/** Whether an item belongs in the picker for this slot (with optional search broadening). */
export function itemRelevantToBuilderSlot(
  item: InventoryItem,
  slot: BuilderSlotDef,
  opts: {
    bundleMode: boolean;
    isLotBundle: boolean;
    searching: boolean;
    assignedInSlot?: InventoryItem[];
    slotId: string;
  }
): boolean {
  const slotMatch = itemMatchesBuilderSlot(item, slot, {
    bundleMode: opts.bundleMode,
    assignedInSlot: opts.assignedInSlot,
  });
  if (slotMatch) return true;
  if (!opts.searching || !opts.bundleMode) return false;

  if (opts.slotId === 'MOBO' && isMotherboardItem(item)) return true;
  if (opts.isLotBundle) return true;

  return false;
}
