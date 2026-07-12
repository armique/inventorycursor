import { InventoryItem, ItemStatus } from '../types';

/** Sold, traded away, or gifted — left active stock and counts toward realized P/L. */
export function isRealizedDisposal(item: Pick<InventoryItem, 'status'>): boolean {
  return (
    item.status === ItemStatus.SOLD ||
    item.status === ItemStatus.TRADED ||
    item.status === ItemStatus.GIFTED
  );
}

export function isSoldOrTradedOnly(item: Pick<InventoryItem, 'status'>): boolean {
  return item.status === ItemStatus.SOLD || item.status === ItemStatus.TRADED;
}

export function isGiftedItem(item: Pick<InventoryItem, 'status'>): boolean {
  return item.status === ItemStatus.GIFTED;
}

/** Date used for period filters on disposed lines. */
export function dispositionDate(item: Pick<InventoryItem, 'status' | 'sellDate' | 'buyDate'>): string | undefined {
  return isRealizedDisposal(item) ? item.sellDate : item.buyDate;
}
