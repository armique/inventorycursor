import type { InventoryItem } from '../types';

/** eBay.de category IDs for common PC parts (#25). */
const EBAY_CATEGORY_BY_KEY: Record<string, string> = {
  Processors: '164',
  CPUs: '164',
  GPUs: '27386',
  'Graphics Cards': '27386',
  RAM: '170083',
  Motherboards: '1244',
  Storage: '175669',
  SSD: '175669',
  HDD: '56083',
  PSUs: '42017',
  'Power Supplies': '42017',
  Cases: '42014',
  Cooling: '131486',
  Monitors: '80053',
  Laptops: '177',
  Components: '175673',
  Peripherals: '31530',
};

export function resolveEbayCategoryId(item: InventoryItem): string {
  const sub = item.subCategory?.trim() || '';
  const cat = item.category?.trim() || '';
  if (sub && EBAY_CATEGORY_BY_KEY[sub]) return EBAY_CATEGORY_BY_KEY[sub];
  if (cat && EBAY_CATEGORY_BY_KEY[cat]) return EBAY_CATEGORY_BY_KEY[cat];
  return '175673';
}
