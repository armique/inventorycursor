import type { InventoryItem } from '../types';
import {
  extractPrimaryComponentKey,
  type ComponentCategory,
} from './componentKeyExtractor';
import { listingHardwareCompatible, normalizeListingText } from './ebayListingMatch';

/** PC hardware brands — order title brand locks the suggested inventory row. */
const KNOWN_BRANDS: readonly string[] = [
  'be quiet',
  'cooler master',
  'g skill',
  'g.skill',
  'lian li',
  'team group',
  'western digital',
  'adata',
  'amd',
  'antec',
  'aorus',
  'arctic',
  'asrock',
  'asus',
  'bequiet',
  'biostar',
  'corsair',
  'crucial',
  'deepcool',
  'evga',
  'fractal',
  'gainward',
  'gigabyte',
  'gskill',
  'hyperx',
  'intel',
  'kingston',
  'lianli',
  'lexar',
  'micron',
  'msi',
  'noctua',
  'nvidia',
  'nzxt',
  'palit',
  'patriot',
  'phanteks',
  'pny',
  'powercolor',
  'samsung',
  'sapphire',
  'seagate',
  'seasonic',
  'silverstone',
  'sk hynix',
  'sandisk',
  'teamgroup',
  'thermaltake',
  'toshiba',
  'transcend',
  'xfx',
  'zotac',
];

const BRAND_ALIASES: Record<string, string> = {
  'be quiet': 'bequiet',
  bequiet: 'bequiet',
  'g skill': 'gskill',
  'g.skill': 'gskill',
  gskill: 'gskill',
  'lian li': 'lianli',
  lianli: 'lianli',
  'team group': 'teamgroup',
  teamgroup: 'teamgroup',
  'western digital': 'wd',
  wd: 'wd',
  'sk hynix': 'hynix',
  hynix: 'hynix',
};

const CATEGORY_FIELD_MAP: Record<string, ComponentCategory> = {
  ram: 'ram',
  arbeitsspeicher: 'ram',
  memory: 'ram',
  cpu: 'cpu',
  prozessor: 'cpu',
  processor: 'cpu',
  gpu: 'gpu',
  grafikkarte: 'gpu',
  graphics: 'gpu',
  grafikkarten: 'gpu',
  storage: 'storage',
  ssd: 'storage',
  hdd: 'storage',
  nvme: 'storage',
  festplatte: 'storage',
  speicher: 'storage',
  motherboard: 'motherboard',
  mainboard: 'motherboard',
  mobo: 'motherboard',
  mainboards: 'motherboard',
  psu: 'psu',
  netzteil: 'psu',
  'power supply': 'psu',
  case: 'case',
  gehaeuse: 'case',
  gehause: 'case',
  tower: 'case',
  cooler: 'cooler',
  kuehler: 'cooler',
  kuhler: 'cooler',
  aio: 'cooler',
  wasserkuehlung: 'cooler',
};

function canonicalBrand(raw: string): string {
  const key = raw.toLowerCase().trim();
  return BRAND_ALIASES[key] ?? key.replace(/\s+/g, '');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Brands mentioned in free text (order title or inventory name). */
export function detectBrands(text: string): string[] {
  const norm = normalizeListingText(text);
  if (!norm) return [];
  const found = new Set<string>();
  for (const brand of KNOWN_BRANDS) {
    const pattern = brand.includes(' ')
      ? escapeRegExp(brand)
      : `\\b${escapeRegExp(brand)}\\b`;
    if (new RegExp(pattern, 'i').test(norm)) {
      found.add(canonicalBrand(brand));
    }
  }
  return [...found];
}

function inventoryBrandSources(item: InventoryItem): string {
  const specs = item.specs || {};
  const brandSpec = specs.Brand ?? specs.brand ?? specs.Marke ?? specs.marke;
  return [item.name, item.vendor, brandSpec].filter(Boolean).join(' ');
}

/**
 * When the order names a brand (e.g. Corsair), inventory with a different brand must not link.
 * Items without a detectable brand stay eligible for manual replace.
 */
export function orderItemBrandCompatible(orderTitle: string, item: InventoryItem): boolean {
  const orderBrands = detectBrands(orderTitle);
  if (!orderBrands.length) return true;
  const itemBrands = detectBrands(inventoryBrandSources(item));
  if (!itemBrands.length) return true;
  return orderBrands.some((ob) => itemBrands.includes(ob));
}

function mapCategoryField(raw: string | undefined | null): ComponentCategory | null {
  if (!raw) return null;
  const key = normalizeListingText(raw).replace(/\s+/g, ' ');
  return CATEGORY_FIELD_MAP[key] ?? null;
}

function resolvePartCategory(...parts: (string | undefined | null)[]): ComponentCategory | null {
  for (const part of parts) {
    const mapped = mapCategoryField(part);
    if (mapped) return mapped;
  }
  for (const part of parts) {
    if (!part?.trim()) continue;
    const hit = extractPrimaryComponentKey(part);
    if (hit && hit.confidence !== 'low') return hit.category;
  }
  const combined = parts.filter(Boolean).join(' ');
  if (!combined.trim()) return null;
  const hit = extractPrimaryComponentKey(combined);
  return hit?.category ?? null;
}

/** RAM sold on eBay must not bind to a CPU inventory row, etc. */
export function orderItemCategoryCompatible(orderTitle: string, item: InventoryItem): boolean {
  const orderCat = resolvePartCategory(orderTitle);
  const itemCat = resolvePartCategory(item.name, item.category, item.subCategory);
  if (!orderCat || !itemCat) return true;
  return orderCat === itemCat;
}

export function orderItemLinkCompatible(orderTitle: string, item: InventoryItem): boolean {
  if (!orderItemBrandCompatible(orderTitle, item)) return false;
  if (!orderItemCategoryCompatible(orderTitle, item)) return false;
  if (!listingHardwareCompatible(item.name, orderTitle)) return false;
  return true;
}

export function linkIncompatibilityReason(orderTitle: string, item: InventoryItem): string | null {
  if (!orderItemBrandCompatible(orderTitle, item)) {
    const orderBrands = detectBrands(orderTitle);
    const itemBrands = detectBrands(inventoryBrandSources(item));
    return `Brand mismatch (${orderBrands.join(', ')} order vs ${itemBrands.join(', ')} item)`;
  }
  if (!orderItemCategoryCompatible(orderTitle, item)) {
    const orderCat = resolvePartCategory(orderTitle);
    const itemCat = resolvePartCategory(item.name, item.category, item.subCategory);
    return `Category mismatch (${orderCat ?? '?'} order vs ${itemCat ?? '?'} item)`;
  }
  if (!listingHardwareCompatible(item.name, orderTitle)) {
    return 'Hardware model mismatch';
  }
  return null;
}
