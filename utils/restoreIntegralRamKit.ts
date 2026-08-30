/**
 * Restore Integral 32GB Kit sold row after a Hub-approve path dropped it.
 * Original figures from deinventory-backup-2026-02-15.json.
 */
import { InventoryItem, ItemStatus } from '../types';

export const INTEGRAL_RAM_KIT_ID = 'imp-1770932245741-1';
export const INTEGRAL_RAM_KIT_NAME = 'Integral 32GB Kit (2x16GB) DDR4 RAM 2400MHz';
export const INTEGRAL_RAM_KIT_BUY = 12.91;
export const INTEGRAL_RAM_KIT_SELL = 39;
export const INTEGRAL_RAM_KIT_PROFIT = 26.09;
export const INTEGRAL_RAM_KIT_BUY_DATE = '2025-02-24';
export const INTEGRAL_RAM_KIT_SELL_DATE = '2025-02-26';

export function isIntegralRamKitItem(item: Pick<InventoryItem, 'id' | 'name'>): boolean {
  if (item.id === INTEGRAL_RAM_KIT_ID) return true;
  return (item.name || '').trim() === INTEGRAL_RAM_KIT_NAME;
}

export function buildIntegralRamKitItem(): InventoryItem {
  return {
    id: INTEGRAL_RAM_KIT_ID,
    name: INTEGRAL_RAM_KIT_NAME,
    buyPrice: INTEGRAL_RAM_KIT_BUY,
    sellPrice: INTEGRAL_RAM_KIT_SELL,
    profit: INTEGRAL_RAM_KIT_PROFIT,
    buyDate: INTEGRAL_RAM_KIT_BUY_DATE,
    sellDate: INTEGRAL_RAM_KIT_SELL_DATE,
    category: 'Components',
    subCategory: 'RAM',
    status: ItemStatus.SOLD,
    comment1: '',
    comment2: '',
    vendor: 'Generic',
    specs: {},
    parentContainerId: undefined,
    storeVisible: false,
  };
}

function withOriginalPrices(item: InventoryItem): InventoryItem {
  return {
    ...item,
    id: item.id || INTEGRAL_RAM_KIT_ID,
    name: INTEGRAL_RAM_KIT_NAME,
    buyPrice: INTEGRAL_RAM_KIT_BUY,
    sellPrice: INTEGRAL_RAM_KIT_SELL,
    profit: INTEGRAL_RAM_KIT_PROFIT,
    buyDate: item.buyDate || INTEGRAL_RAM_KIT_BUY_DATE,
    sellDate: item.sellDate || INTEGRAL_RAM_KIT_SELL_DATE,
    status: ItemStatus.SOLD,
    category: item.category || 'Components',
    subCategory: item.subCategory || 'RAM',
    parentContainerId: undefined,
    storeVisible: false,
  };
}

function keepHubFigures(item: InventoryItem): boolean {
  const p = item.saleProceeds;
  return p?.source === 'ebay_seller_hub' && Number(p.buyerTotalEur) >= 0.01;
}

function alreadyRestored(item: InventoryItem): boolean {
  if (!isIntegralRamKitItem(item) || item.status !== ItemStatus.SOLD || item.parentContainerId) return false;
  if (keepHubFigures(item)) return true;
  return item.buyPrice === INTEGRAL_RAM_KIT_BUY && item.sellPrice === INTEGRAL_RAM_KIT_SELL;
}

function withVisibleSoldShell(item: InventoryItem): InventoryItem {
  if (keepHubFigures(item)) {
    return {
      ...item,
      id: item.id || INTEGRAL_RAM_KIT_ID,
      name: INTEGRAL_RAM_KIT_NAME,
      buyPrice: INTEGRAL_RAM_KIT_BUY,
      buyDate: item.buyDate || INTEGRAL_RAM_KIT_BUY_DATE,
      sellDate: item.sellDate || INTEGRAL_RAM_KIT_SELL_DATE,
      status: ItemStatus.SOLD,
      category: item.category || 'Components',
      subCategory: item.subCategory || 'RAM',
      parentContainerId: undefined,
      storeVisible: false,
    };
  }
  return withOriginalPrices(item);
}

function detachKitFromContainers(items: InventoryItem[], kitId: string): InventoryItem[] {
  let changed = false;
  const next = items.map((item) => {
    const ids = item.componentIds;
    if (!ids?.includes(kitId)) return item;
    changed = true;
    return { ...item, componentIds: ids.filter((id) => id !== kitId) };
  });
  return changed ? next : items;
}

export function restoreIntegralRamKit(
  items: InventoryItem[],
  trash: InventoryItem[] = []
): { items: InventoryItem[]; trash: InventoryItem[]; changed: boolean } {
  const inItems = items.find(isIntegralRamKitItem);
  if (inItems) {
    const detached = detachKitFromContainers(items, inItems.id);
    if (alreadyRestored(inItems) && detached === items) {
      return { items, trash, changed: false };
    }
    return {
      items: detached.map((item) => (isIntegralRamKitItem(item) ? withVisibleSoldShell(item) : item)),
      trash,
      changed: true,
    };
  }

  const inTrash = trash.find(isIntegralRamKitItem);
  if (inTrash) {
    const restored = withVisibleSoldShell(inTrash);
    return {
      items: [...detachKitFromContainers(items, restored.id), restored],
      trash: trash.filter((item) => !isIntegralRamKitItem(item)),
      changed: true,
    };
  }

  if (items.length === 0 && trash.length === 0) {
    return { items, trash, changed: false };
  }

  const created = buildIntegralRamKitItem();
  return {
    items: [...detachKitFromContainers(items, created.id), created],
    trash,
    changed: true,
  };
}
