import type { InventoryItem, Platform } from '../types';

const PLATFORM_LABELS: Record<string, string> = {
  'ebay.de': 'eBay',
  'kleinanzeigen.de': 'Kleinanzeigen',
  Amazon: 'Amazon',
  Other: 'Other',
};

export type ResolvedSalePlatform = Platform | 'unknown';

/** Prefer platformSold; fall back to payment type when legacy rows lack platform. */
export function resolveSalePlatform(
  item: Pick<InventoryItem, 'platformSold' | 'paymentType'>
): ResolvedSalePlatform {
  if (item.platformSold) return item.platformSold;
  const pt = item.paymentType;
  if (pt === 'ebay.de') return 'ebay.de';
  if (pt?.startsWith('Kleinanzeigen')) return 'kleinanzeigen.de';
  return 'unknown';
}

export function formatSalePlatformLabel(platform?: ResolvedSalePlatform | string): string {
  if (!platform || platform === 'unknown') return 'Unknown';
  return PLATFORM_LABELS[platform] ?? platform;
}

export function formatItemSalePlatform(item: Pick<InventoryItem, 'platformSold' | 'paymentType'>): string {
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

export function platformGroupKey(
  item: Pick<InventoryItem, 'platformSold' | 'paymentType'>
): PlatformGroupKey {
  return toPlatformGroupKey(resolveSalePlatform(item));
}

export function groupSalesByPlatform<T extends Pick<InventoryItem, 'platformSold' | 'paymentType'>>(
  sold: T[]
): Record<PlatformGroupKey, T[]> {
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

export function countSalesByPlatform(
  sold: Pick<InventoryItem, 'platformSold' | 'paymentType'>[]
): PlatformSalesCounts {
  const groups = groupSalesByPlatform(sold);
  return {
    ebay: groups.ebay.length,
    kleinanzeigen: groups.kleinanzeigen.length,
    amazon: groups.amazon.length,
    other: groups.other.length,
    unknown: groups.unknown.length,
  };
}
