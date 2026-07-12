import type { InventoryItem } from '../types';
import { getEssentialSpecFieldKeys } from '../services/essentialSpecFields';
import { orderedSpecKeys } from '../components/storefront/storefrontUtils';
import { formatEUR } from './formatMoney';

export type ProductCardFamily = 'pc' | '3d' | 'generic';

export function detectProductCardFamily(item: InventoryItem): ProductCardFamily {
  if (item.specs?.['Production Method'] === '3D Printed' || item.subCategory === '3D Printed') {
    return '3d';
  }
  if (
    item.category === 'Components' ||
    item.category === 'PC' ||
    item.category === 'Laptops' ||
    item.category === 'Peripherals' ||
    item.isPC ||
    item.isBundle
  ) {
    return 'pc';
  }
  return 'generic';
}

/** Default marketing USPs per product family (German, eBay/Kleinanzeigen friendly). */
export const DEFAULT_USPS: Record<ProductCardFamily, string[]> = {
  pc: [
    'Geprüfte Hardware',
    'Versand aus Deutschland',
    'Sofort verfügbar',
    'Voll funktionsfähig',
  ],
  '3d': [
    '3D gedruckt in Deutschland',
    '2–3 Tage Lieferung',
    '2 Farbauswahl',
    'Premium PLA+ Filament',
  ],
  generic: [
    'Versand aus Deutschland',
    'Sofort verfügbar',
    'Sorgfältig verpackt',
  ],
};

export interface ProductCardSpecLine {
  label: string;
  value: string;
}

export function getProductCardSpecs(
  item: InventoryItem,
  categoryFields?: string[],
  max = 6
): ProductCardSpecLine[] {
  const specs = item.specs || {};
  const keys = orderedSpecKeys(specs, categoryFields);
  const essential = getEssentialSpecFieldKeys(item.category, item.subCategory);
  const prioritized = [
    ...essential.filter((k) => specs[k] != null && String(specs[k]).trim()),
    ...keys.filter((k) => !essential.includes(k)),
  ];

  const skip = new Set(['Production Method', 'Filament Spool ID']);
  const lines: ProductCardSpecLine[] = [];
  for (const key of prioritized) {
    if (skip.has(key)) continue;
    const raw = specs[key];
    if (raw == null || String(raw).trim() === '') continue;
    lines.push({ label: key, value: String(raw).trim() });
    if (lines.length >= max) break;
  }
  return lines;
}

export function getProductCardPrice(item: InventoryItem): { label: string; value: string; hasPrice: boolean } {
  const price = item.storePrice ?? item.sellPrice;
  if (price != null && price > 0) {
    return { label: 'Preis', value: `${formatEUR(price)} €`, hasPrice: true };
  }
  return { label: 'Preis', value: 'Preis auf Anfrage', hasPrice: false };
}

export function getProductCardSubtitle(item: InventoryItem): string {
  const parts = [item.category];
  if (item.subCategory) parts.push(item.subCategory);
  if (item.vendor?.trim()) parts.push(item.vendor.trim());
  return parts.join(' · ');
}

export function getProductCardBadge(item: InventoryItem, family: ProductCardFamily): string | null {
  if (family === '3d') return '3D Print';
  if (item.status === 'Sold') return null;
  if (item.isDefective) return 'Defekt / Ersatzteile';
  if (item.category === 'Components') return 'Hardware';
  if (item.isPC) return 'Custom PC';
  return null;
}
