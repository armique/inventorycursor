/**
 * Exact product identity for AI card gallery sharing.
 * Only links items when maker + model (+ Ti/Super) match with high confidence.
 */

import type { InventoryItem } from '../types';
import { ItemStatus } from '../types';
import { extractPrimaryComponentKey } from './componentKeyExtractor';

const MAKERS = [
  'cooler master',
  'western digital',
  'silicon power',
  'teamgroup',
  'g.skill',
  'gskill',
  'be quiet',
  'bequiet',
  'lian li',
  'powercolor',
  'gigabyte',
  'aorus',
  'sapphire',
  'thermaltake',
  'fractal',
  'seasonic',
  'asrock',
  'biostar',
  'colorful',
  'gainward',
  'inno3d',
  'kingston',
  'corsair',
  'crucial',
  'patriot',
  'samsung',
  'seagate',
  'toshiba',
  'galax',
  'kfa2',
  'palit',
  'zotac',
  'manli',
  'yeston',
  'maxsun',
  'leadtek',
  'nvidia',
  'visiontek',
  'asus',
  'msi',
  'evga',
  'xfx',
  'pny',
  'amd',
  'intel',
  'nzxt',
  'wd',
  'hp',
  'dell',
  'lenovo',
].sort((a, b) => b.length - a.length);

function normalizeMaker(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9.+]/g, '')
    .replace(/^g\.?skill$/, 'gskill')
    .replace(/^bequiet$/, 'bequiet')
    .replace(/^westerndigital$/, 'wd')
    .replace(/^coolermaster$/, 'coolermaster');
}

/** Brand from vendor, specs, or name — null if unknown (no guessing). */
export function extractProductMaker(
  item: Pick<InventoryItem, 'name' | 'vendor' | 'specs'>
): string | null {
  const fromVendor = (item.vendor || '').trim();
  if (fromVendor) {
    const hit = MAKERS.find((m) => normalizeMaker(fromVendor).includes(normalizeMaker(m)));
    if (hit) return normalizeMaker(hit);
    // Explicit vendor string counts as maker when short enough
    if (fromVendor.length <= 24) return normalizeMaker(fromVendor);
  }

  const specs = item.specs || {};
  for (const key of ['Brand', 'Manufacturer', 'Maker', 'Hersteller', 'Marke']) {
    const hit = Object.entries(specs).find(([k]) => k.toLowerCase() === key.toLowerCase());
    const val = hit?.[1] != null ? String(hit[1]).trim() : '';
    if (!val) continue;
    const maker = MAKERS.find((m) => normalizeMaker(val).includes(normalizeMaker(m)));
    if (maker) return normalizeMaker(maker);
    if (val.length <= 24) return normalizeMaker(val);
  }

  const hay = (item.name || '').toLowerCase();
  for (const m of MAKERS) {
    const re = new RegExp(`\\b${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*')}\\b`, 'i');
    if (re.test(hay)) return normalizeMaker(m);
  }
  return null;
}

/**
 * Fingerprint for 100% same product line: maker + high-confidence component key
 * (GPU key already encodes Ti / Super).
 */
export function productCardIdentityFingerprint(
  item: Pick<InventoryItem, 'name' | 'vendor' | 'specs'>
): string | null {
  const name = (item.name || '').trim();
  if (name.length < 3) return null;
  const key = extractPrimaryComponentKey(name);
  if (!key || key.confidence !== 'high') return null;
  const maker = extractProductMaker(item);
  if (!maker) return null;
  return `${maker}|${key.componentKey}`;
}

export type ProductCardGalleryOwner = {
  /** itemId to store new cards under */
  ownerId: string;
  ownerName: string;
  /** True when owner is a different inventory row (shared parent SKU). */
  isSharedParent: boolean;
  parent: InventoryItem | null;
};

function rankParent(a: InventoryItem, b: InventoryItem): number {
  const stockScore = (i: InventoryItem) =>
    i.status === ItemStatus.IN_STOCK || i.status === ItemStatus.ORDERED ? 0 : 1;
  const dateA = a.buyDate || a.id || '';
  const dateB = b.buyDate || b.id || '';
  return stockScore(a) - stockScore(b) || dateA.localeCompare(dateB) || a.id.localeCompare(b.id);
}

/**
 * Find the canonical parent inventory item for card-gallery storage.
 * Returns null when no exact maker+model(+Ti) twin exists.
 */
export function findExactProductCardParent(
  inventory: InventoryItem[],
  current: Pick<InventoryItem, 'id' | 'name' | 'vendor' | 'specs'>,
): InventoryItem | null {
  const fp = productCardIdentityFingerprint(current);
  if (!fp) return null;

  const matches = inventory
    .filter((i) => i.id && i.id !== current.id && !i.isDraft && !i.isPC && !i.isBundle)
    .filter((i) => productCardIdentityFingerprint(i) === fp);

  if (!matches.length) return null;
  return [...matches].sort(rankParent)[0] || null;
}

/** Resolve where generated cards should be stored for this item. */
export function resolveProductCardGalleryOwner(
  inventory: InventoryItem[],
  current: Pick<InventoryItem, 'id' | 'name' | 'vendor' | 'specs'>,
): ProductCardGalleryOwner {
  const selfId = (current.id || '').trim() || 'draft';
  const selfName = (current.name || '').trim() || 'Item';
  const parent = findExactProductCardParent(inventory, current);
  if (parent?.id) {
    return {
      ownerId: parent.id,
      ownerName: parent.name,
      isSharedParent: true,
      parent,
    };
  }
  return {
    ownerId: selfId,
    ownerName: selfName,
    isSharedParent: false,
    parent: null,
  };
}

/** itemIds whose galleries should be shown for this product (self + parent). */
export function productCardGalleryItemIds(
  inventory: InventoryItem[],
  current: Pick<InventoryItem, 'id' | 'name' | 'vendor' | 'specs'>,
): string[] {
  const owner = resolveProductCardGalleryOwner(inventory, current);
  const ids = new Set<string>();
  if (current.id) ids.add(current.id);
  ids.add(owner.ownerId);
  return [...ids].filter(Boolean);
}
