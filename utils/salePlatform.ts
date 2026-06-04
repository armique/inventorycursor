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
