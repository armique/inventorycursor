/**
 * Rename category / subcategory labels and keep inventory rows + spec-field keys in sync.
 * Renaming only the catalog left stale item.subCategory values (e.g. "Graphics Cards" after
 * renaming the pin to "GPU"), so filters looked empty.
 */
import type { InventoryItem } from '../types';

export type CategoryCatalogState = {
  categories: Record<string, string[]>;
  categoryFields: Record<string, string[]>;
  items: InventoryItem[];
};

export function countItemsWithSubcategory(
  items: InventoryItem[],
  category: string,
  subCategory: string
): number {
  return items.filter((i) => i.category === category && i.subCategory === subCategory).length;
}

function mergeFieldKeys(
  fields: Record<string, string[]>,
  fromKey: string,
  toKey: string
): Record<string, string[]> {
  if (fromKey === toKey || !fields[fromKey]) return fields;
  const next = { ...fields };
  next[toKey] = Array.from(new Set([...(next[toKey] || []), ...next[fromKey]]));
  delete next[fromKey];
  return next;
}

export function renameSubcategoryInCatalog(
  state: CategoryCatalogState,
  category: string,
  fromSub: string,
  toSub: string
): CategoryCatalogState & { movedCount: number } {
  const to = toSub.trim();
  if (!to || to === fromSub) {
    return { ...state, movedCount: 0 };
  }

  const categories = { ...state.categories };
  const subs = categories[category] || [];
  categories[category] = Array.from(new Set(subs.map((s) => (s === fromSub ? to : s))));

  const categoryFields = mergeFieldKeys(
    { ...state.categoryFields },
    `${category}:${fromSub}`,
    `${category}:${to}`
  );

  let movedCount = 0;
  const items = state.items.map((i) => {
    if (i.category === category && i.subCategory === fromSub) {
      movedCount += 1;
      return { ...i, subCategory: to };
    }
    return i;
  });

  return { categories, categoryFields, items, movedCount };
}

export function renameCategoryInCatalog(
  state: CategoryCatalogState,
  fromCat: string,
  toCat: string
): CategoryCatalogState & { movedCount: number } {
  const to = toCat.trim();
  if (!to || to === fromCat) {
    return { ...state, movedCount: 0 };
  }

  const categories = { ...state.categories };
  const subs = categories[fromCat] || [];
  delete categories[fromCat];
  categories[to] = Array.from(new Set([...(categories[to] || []), ...subs]));

  let categoryFields = { ...state.categoryFields };
  for (const sub of subs) {
    categoryFields = mergeFieldKeys(categoryFields, `${fromCat}:${sub}`, `${to}:${sub}`);
  }
  categoryFields = mergeFieldKeys(categoryFields, fromCat, to);

  let movedCount = 0;
  const items = state.items.map((i) => {
    if (i.category === fromCat) {
      movedCount += 1;
      return { ...i, category: to };
    }
    return i;
  });

  return { categories, categoryFields, items, movedCount };
}

/** Legacy GPU subcategory labels that users commonly rename to "GPU". */
export const LEGACY_GPU_SUBCATEGORY_ALIASES = [
  'Graphics Cards',
  'Graphic Cards',
  'Grafikkarten',
  'Grafikkarte',
] as const;

/**
 * If Components already has "GPU", remap legacy GPU subcategory strings on items and
 * drop the old labels from the catalog.
 */
export function migrateLegacyGpuSubcategoryNames(
  state: CategoryCatalogState
): CategoryCatalogState & { movedCount: number; changed: boolean } {
  const components = state.categories.Components || [];
  if (!components.includes('GPU')) {
    return { ...state, movedCount: 0, changed: false };
  }

  const legacySet = new Set<string>(LEGACY_GPU_SUBCATEGORY_ALIASES);
  let movedCount = 0;
  const items = state.items.map((i) => {
    if (!i.subCategory || !legacySet.has(i.subCategory)) return i;
    movedCount += 1;
    return { ...i, subCategory: 'GPU' };
  });

  let categories = { ...state.categories };
  let categoryFields = { ...state.categoryFields };
  let catalogTouched = false;

  for (const [cat, subs] of Object.entries(categories)) {
    const hadLegacy = subs.some((s) => legacySet.has(s));
    if (!hadLegacy && cat !== 'Components') continue;
    const nextSubs = Array.from(
      new Set(subs.map((s) => (legacySet.has(s) ? 'GPU' : s)).filter(Boolean))
    );
    if (cat === 'Components' && !nextSubs.includes('GPU')) nextSubs.unshift('GPU');
    if (nextSubs.join('\0') !== subs.join('\0')) {
      categories[cat] = nextSubs;
      catalogTouched = true;
    }
  }

  for (const cat of Object.keys(categories)) {
    for (const legacy of LEGACY_GPU_SUBCATEGORY_ALIASES) {
      const before = categoryFields;
      categoryFields = mergeFieldKeys(categoryFields, `${cat}:${legacy}`, `${cat}:GPU`);
      if (categoryFields !== before) catalogTouched = true;
    }
  }

  const changed = movedCount > 0 || catalogTouched;
  return { categories, categoryFields, items, movedCount, changed };
}
