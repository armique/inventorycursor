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
  const counts: PlatformSalesCounts = { ebay: 0, kleinanzeigen: 0, amazon: 0, other: 0, unknown: 0 };
  for (const item of sold) {
    const p = resolveSalePlatform(item);
    if (p === 'ebay.de') counts.ebay += 1;
    else if (p === 'kleinanzeigen.de') counts.kleinanzeigen += 1;
    else if (p === 'Amazon') counts.amazon += 1;
    else if (p === 'Other') counts.other += 1;
    else counts.unknown += 1;
  }
  return counts;
}
