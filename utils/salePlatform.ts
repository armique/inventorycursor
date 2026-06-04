import type { InventoryItem, Platform } from '../types';
import { roundMoney } from '../services/financialAggregation';

const PLATFORM_LABELS: Record<string, string> = {
  'ebay.de': 'eBay',
  'kleinanzeigen.de': 'Kleinanzeigen',
  Amazon: 'Amazon',
  Other: 'Other',
};

export type ResolvedSalePlatform = Platform | 'unknown';

export type SalePlatformFields = Pick<
  InventoryItem,
  'platformSold' | 'paymentType' | 'ebayOrderId' | 'ebayUsername'
>;

/** eBay order ID, username, or payment type — even when platformSold was never set (common after CSV import). */
export function hasEbaySaleSignals(item: SalePlatformFields): boolean {
  if (item.ebayOrderId?.trim()) return true;
  if (item.ebayUsername?.trim()) return true;
  if (item.paymentType === 'ebay.de') return true;
  return false;
}

/**
 * Resolve where the item was sold. Explicit platformSold wins; otherwise infer from eBay fields / payment type.
 */
export function resolveSalePlatform(item: SalePlatformFields): ResolvedSalePlatform {
  if (item.platformSold) return item.platformSold;
  if (hasEbaySaleSignals(item)) return 'ebay.de';
  const pt = item.paymentType;
  if (pt?.startsWith('Kleinanzeigen')) return 'kleinanzeigen.de';
  return 'unknown';
}

export function itemMatchesSalePlatformFilter(item: SalePlatformFields, filter: Platform): boolean {
  return resolveSalePlatform(item) === filter;
}

export function formatSalePlatformLabel(platform?: ResolvedSalePlatform | string): string {
  if (!platform || platform === 'unknown') return 'Unknown';
  return PLATFORM_LABELS[platform] ?? platform;
}

export function formatItemSalePlatform(item: SalePlatformFields): string {
  return formatSalePlatformLabel(resolveSalePlatform(item));
}

export type PlatformGroupKey = 'ebay' | 'kleinanzeigen' | 'amazon' | 'other' | 'unknown';

export const PLATFORM_GROUP_LABEL: Record<PlatformGroupKey, string> = {
  ebay: 'eBay',
  kleinanzeigen: 'Kleinanzeigen',
  amazon: 'Amazon',
  other: 'Other',
  unknown: 'Unknown',
};

function toPlatformGroupKey(platform: ResolvedSalePlatform): PlatformGroupKey {
  if (platform === 'ebay.de') return 'ebay';
  if (platform === 'kleinanzeigen.de') return 'kleinanzeigen';
  if (platform === 'Amazon') return 'amazon';
  if (platform === 'Other') return 'other';
  return 'unknown';
}

export function platformGroupKey(item: SalePlatformFields): PlatformGroupKey {
  return toPlatformGroupKey(resolveSalePlatform(item));
}

export function groupSalesByPlatform<T extends SalePlatformFields>(sold: T[]): Record<PlatformGroupKey, T[]> {
  const groups: Record<PlatformGroupKey, T[]> = {
    ebay: [],
    kleinanzeigen: [],
    amazon: [],
    other: [],
    unknown: [],
  };
  for (const item of sold) {
    groups[platformGroupKey(item)].push(item);
  }
  return groups;
}

export type PlatformSalesCounts = {
  ebay: number;
  kleinanzeigen: number;
  amazon: number;
  other: number;
  unknown: number;
};

export function countSalesByPlatform(sold: SalePlatformFields[]): PlatformSalesCounts {
  const groups = groupSalesByPlatform(sold);
  return {
    ebay: groups.ebay.length,
    kleinanzeigen: groups.kleinanzeigen.length,
    amazon: groups.amazon.length,
    other: groups.other.length,
    unknown: groups.unknown.length,
  };
}

export type PlatformRevenueTotals = Record<PlatformGroupKey, number>;

export function sumRevenueByPlatform(sold: InventoryItem[]): PlatformRevenueTotals {
  const groups = groupSalesByPlatform(sold);
  const totals: PlatformRevenueTotals = { ebay: 0, kleinanzeigen: 0, amazon: 0, other: 0, unknown: 0 };
  for (const key of Object.keys(totals) as PlatformGroupKey[]) {
    totals[key] = roundMoney(groups[key].reduce((acc, i) => acc + (Number(i.sellPrice) || 0), 0));
  }
  return totals;
}

/** Sold on eBay (by signals) but stored under another / missing platform tag. */
export function findLikelyMisclassifiedEbayItems(sold: InventoryItem[]): InventoryItem[] {
  return sold.filter((i) => platformGroupKey(i) !== 'ebay' && hasEbaySaleSignals(i));
}

/** Sold with no platform and no eBay/Klein signals — needs manual tagging. */
export function findItemsNeedingPlatformTag(sold: InventoryItem[]): InventoryItem[] {
  return sold.filter(
    (i) =>
      !i.platformSold &&
      !hasEbaySaleSignals(i) &&
      !i.paymentType?.startsWith('Kleinanzeigen')
  );
}

/** Apply eBay platform tags where order ID / username / payment prove eBay but platformSold was empty. */
export function buildEbayTagFixUpdates(items: InventoryItem[]): InventoryItem[] {
  return items
    .map((item) => {
      if (platformGroupKey(item) === 'ebay' && item.platformSold === 'ebay.de') return null;
      if (!hasEbaySaleSignals(item)) return null;
      if (item.platformSold && item.platformSold !== 'ebay.de') return null;
      return {
        ...item,
        platformSold: 'ebay.de' as Platform,
        paymentType: item.paymentType || 'ebay.de',
      };
    })
    .filter((x): x is InventoryItem => x !== null);
}

export type PlatformReconciliation = {
  platformRevenue: PlatformRevenueTotals;
  unknownRevenue: number;
  misclassifiedEbay: InventoryItem[];
  misclassifiedEbayRevenue: number;
  needingTag: InventoryItem[];
  needingTagRevenue: number;
  zeroSellPrice: InventoryItem[];
};

export function buildPlatformReconciliation(sold: InventoryItem[]): PlatformReconciliation {
  const platformRevenue = sumRevenueByPlatform(sold);
  const misclassifiedEbay = findLikelyMisclassifiedEbayItems(sold);
  const needingTag = findItemsNeedingPlatformTag(sold);
  const zeroSellPrice = sold.filter((i) => !(Number(i.sellPrice) > 0));
  return {
    platformRevenue,
    unknownRevenue: platformRevenue.unknown,
    misclassifiedEbay,
    misclassifiedEbayRevenue: roundMoney(
      misclassifiedEbay.reduce((acc, i) => acc + (Number(i.sellPrice) || 0), 0)
    ),
    needingTag,
    needingTagRevenue: roundMoney(needingTag.reduce((acc, i) => acc + (Number(i.sellPrice) || 0), 0)),
    zeroSellPrice,
  };
}

export type MarketplaceOrderStats = {
  /** Inventory rows counted (bundle parts = multiple items). */
  itemCount: number;
  /** Buyer-facing orders — matches eBay “Stückzahl” when order IDs / bundle splits align. */
  orderCount: number;
};

function marketplaceOrderKey(item: InventoryItem): string {
  const oid = item.ebayOrderId?.trim();
  if (oid) return `oid:${oid}`;
  const sellDay = item.sellDate?.slice(0, 10) || '';
  if (item.parentContainerId && sellDay) return `bundle:${item.parentContainerId}:${sellDay}`;
  return `solo:${item.id}`;
}

/** Count marketplace orders vs inventory line items (bundles / shared order IDs collapse to one order). */
export function countMarketplaceOrders(items: InventoryItem[]): MarketplaceOrderStats {
  const itemCount = items.length;
  if (itemCount === 0) return { itemCount: 0, orderCount: 0 };
  const keys = new Set(items.map(marketplaceOrderKey));
  return { itemCount, orderCount: keys.size };
}

export type MarketplaceOrderGroup = {
  key: string;
  label: string;
  items: InventoryItem[];
  revenue: number;
};

export function groupItemsByMarketplaceOrder(
  items: InventoryItem[],
  allItems?: InventoryItem[]
): MarketplaceOrderGroup[] {
  const map = new Map<string, InventoryItem[]>();
  for (const item of items) {
    const key = marketplaceOrderKey(item);
    const list = map.get(key) || [];
    list.push(item);
    map.set(key, list);
  }
  return [...map.entries()].map(([key, groupItems]) => {
    const first = groupItems[0]!;
    const oid = first.ebayOrderId?.trim();
    let label: string;
    if (oid) {
      label = groupItems.length > 1 ? `eBay order #${oid} (${groupItems.length} parts)` : `eBay order #${oid}`;
    } else if (first.parentContainerId) {
      const parent = allItems?.find((i) => i.id === first.parentContainerId);
      const day = first.sellDate?.slice(0, 10) || '';
      label = parent
        ? `Bundle: ${parent.name} (${groupItems.length} parts${day ? ` · ${day}` : ''})`
        : `Bundle split · ${groupItems.length} parts`;
    } else {
      label = first.name;
    }
    const revenue = roundMoney(groupItems.reduce((acc, i) => acc + (Number(i.sellPrice) || 0), 0));
    return { key, label, items: groupItems, revenue };
  });
}

export type PlatformOrderStatsMap = Record<PlatformGroupKey, MarketplaceOrderStats>;

export function countOrdersByPlatform(sold: InventoryItem[]): PlatformOrderStatsMap {
  const groups = groupSalesByPlatform(sold);
  const out = {} as PlatformOrderStatsMap;
  for (const key of Object.keys(groups) as PlatformGroupKey[]) {
    out[key] = countMarketplaceOrders(groups[key]);
  }
  return out;
}
