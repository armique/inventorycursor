import { InventoryItem, PaymentType, Platform } from '../types';

const LAST_ADD_KEY = 'deinventory:last-single-add-template';
const PRESETS_KEY = 'deinventory:single-add-presets';

export interface ItemAddTemplate {
  nameHint?: string;
  category?: string;
  subCategory?: string;
  vendor?: string;
  platformBought?: Platform;
  buyPaymentType?: PaymentType;
  hasOVP?: boolean;
  usesDifferentialVat?: boolean;
  buyPrice?: number;
  savedAt: string;
  label: string;
}

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function loadLastAddTemplate(): ItemAddTemplate | null {
  return safeParse<ItemAddTemplate>(localStorage.getItem(LAST_ADD_KEY));
}

export function saveLastAddTemplate(item: InventoryItem): void {
  const tpl: ItemAddTemplate = {
    nameHint: item.name,
    category: item.category,
    subCategory: item.subCategory,
    vendor: item.vendor,
    platformBought: item.platformBought,
    buyPaymentType: item.buyPaymentType,
    hasOVP: item.hasOVP,
    usesDifferentialVat: item.usesDifferentialVat,
    buyPrice: item.buyPrice,
    savedAt: new Date().toISOString(),
    label: item.name.slice(0, 48) || 'Last item',
  };
  try {
    localStorage.setItem(LAST_ADD_KEY, JSON.stringify(tpl));
  } catch {
    /* quota */
  }
}

export function loadSavedPresets(): ItemAddTemplate[] {
  return safeParse<ItemAddTemplate[]>(localStorage.getItem(PRESETS_KEY)) || [];
}

export function upsertSavedPreset(tpl: ItemAddTemplate): ItemAddTemplate[] {
  const list = loadSavedPresets().filter((p) => p.label !== tpl.label);
  const next = [{ ...tpl, savedAt: new Date().toISOString() }, ...list].slice(0, 12);
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(next));
  } catch {
    /* quota */
  }
  return next;
}

/** Build quick presets from recent inventory (vendor + platform + payment + category). */
export function buildHistoryPresets(items: InventoryItem[], limit = 6): ItemAddTemplate[] {
  const seen = new Set<string>();
  const out: ItemAddTemplate[] = [];
  const sorted = [...items]
    .filter((i) => !i.isDraft && !i.isPC && !i.isBundle)
    .sort((a, b) => (b.buyDate || '').localeCompare(a.buyDate || ''));

  for (const i of sorted) {
    const key = [
      i.category,
      i.subCategory || '',
      i.vendor || '',
      i.platformBought || '',
      i.buyPaymentType || '',
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const parts = [
      i.subCategory || i.category,
      i.vendor,
      i.platformBought === 'kleinanzeigen.de' ? 'KA' : i.platformBought === 'ebay.de' ? 'eBay' : i.platformBought,
    ].filter(Boolean);
    out.push({
      category: i.category,
      subCategory: i.subCategory,
      vendor: i.vendor,
      platformBought: i.platformBought,
      buyPaymentType: i.buyPaymentType,
      hasOVP: i.hasOVP,
      usesDifferentialVat: i.usesDifferentialVat,
      savedAt: i.buyDate || new Date().toISOString(),
      label: parts.join(' · ') || i.category,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function applyTemplateFields(
  prev: Partial<InventoryItem>,
  tpl: ItemAddTemplate,
  opts?: { keepName?: boolean }
): Partial<InventoryItem> {
  return {
    ...prev,
    ...(opts?.keepName ? {} : tpl.nameHint ? { name: tpl.nameHint } : {}),
    ...(tpl.category ? { category: tpl.category } : {}),
    ...(tpl.subCategory ? { subCategory: tpl.subCategory } : {}),
    ...(tpl.vendor !== undefined ? { vendor: tpl.vendor } : {}),
    ...(tpl.platformBought ? { platformBought: tpl.platformBought } : {}),
    ...(tpl.buyPaymentType ? { buyPaymentType: tpl.buyPaymentType } : {}),
    ...(tpl.hasOVP !== undefined ? { hasOVP: tpl.hasOVP } : {}),
    ...(tpl.usesDifferentialVat !== undefined ? { usesDifferentialVat: tpl.usesDifferentialVat } : {}),
  };
}
