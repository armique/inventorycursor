import { ItemStatus, type InventoryItem } from '../types';
import { todayLocalDateKey } from './calendarDate';
import { suggestBundleComponentPrices } from './bundlePriceRecalc';

export type RetroComposeKind = 'mixed' | 'bundle' | 'pc';

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function buildRetroContainerAndComponents(args: {
  items: InventoryItem[];
  allItems: InventoryItem[];
  kind: RetroComposeKind;
  bundleName: string;
  sellDate: string;
  useSmartDistribution: boolean;
}): { bundle: InventoryItem; updatedComponents: InventoryItem[] } {
  const { items, allItems, kind, bundleName, sellDate, useSmartDistribution } = args;
  const bundleId = `bundle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const totalBuy = round2(items.reduce((sum, i) => sum + Number(i.buyPrice || 0), 0));
  const totalSell = round2(items.reduce((sum, i) => sum + Number(i.sellPrice || 0), 0));
  const totalFees = round2(items.reduce((sum, i) => sum + Number(i.feeAmount || 0), 0));
  const hasFees = items.some((i) => i.hasFee);
  const margin = round2(totalSell - totalBuy - totalFees);

  const containerCategory = kind === 'pc' ? 'PC' : kind === 'bundle' ? 'Bundle' : 'Mixed Bundle';
  const bundle: InventoryItem = {
    id: bundleId,
    name: bundleName,
    category: containerCategory,
    status: ItemStatus.SOLD,
    buyPrice: totalBuy,
    buyDate: todayLocalDateKey(),
    sellPrice: totalSell,
    profit: margin,
    feeAmount: totalFees,
    hasFee: hasFees,
    sellDate,
    platformSold: items[0]?.platformSold || 'Other',
    paymentType: items[0]?.paymentType || 'Other',
    // Mutually exclusive — a Gaming PC must not also wear the Bundle badge.
    isPC: kind === 'pc',
    isBundle: kind !== 'pc',
    componentIds: items.map((i) => i.id),
    comment1: `Retroactive ${containerCategory} of ${items.length} items.`,
    comment2: '',
    vendor: kind === 'pc' ? 'Custom Build' : kind === 'bundle' ? 'PC Bundle' : 'Mixed Bundle',
  };

  let perComponentSellPrice = new Map<string, number>();
  if (useSmartDistribution && totalSell > 0) {
    const suggestions = suggestBundleComponentPrices(bundle, allItems);
    if (suggestions.length > 0) {
      perComponentSellPrice = new Map(suggestions.map((s) => [s.itemId, round2(s.newSellPrice)]));
    }
  }

  const updatedComponents = items.map((i) => {
    const nextSell = perComponentSellPrice.get(i.id);
    const sellPrice = typeof nextSell === 'number' ? nextSell : i.sellPrice;
    const fee = Number(i.feeAmount || 0);
    const buy = Number(i.buyPrice || 0);
    const profit = typeof sellPrice === 'number' ? round2(sellPrice - buy - fee) : i.profit;
    return {
      ...i,
      status: ItemStatus.IN_COMPOSITION,
      parentContainerId: bundleId,
      sellPrice,
      profit,
    };
  });

  return { bundle, updatedComponents };
}

