import { filterUsableImageUrls } from '../../services/storefrontImageUtils';
import type { StoreCatalogPayload } from '../../services/firebaseService';

export type StoreItem = NonNullable<StoreCatalogPayload['items']>[number];

export const PREFERRED_SPEC_ORDER = [
  'CPU', 'Prozessor', 'Processor', 'GPU', 'Grafikkarte', 'Graphics', 'RAM', 'Memory', 'Speicher',
  'Motherboard', 'Mainboard', 'Board', 'Storage', 'SSD', 'HDD', 'Festplatte', 'PSU', 'Netzteil', 'Power',
  'Case', 'Gehäuse', 'Cooler', 'Kühler', 'CPU Cooler', 'Cores', 'Threads', 'Socket', 'Chipset',
  'VRAM', 'TDP', 'Base Clock', 'Boost Clock', 'Form Factor', 'Capacity', 'Speed', 'Type',
];

export function orderedSpecKeys(specs: Record<string, string | number>, categoryFields?: string[]): string[] {
  const keys = Object.keys(specs);
  if (categoryFields?.length) {
    const ordered = categoryFields.filter((k) => specs[k] != null);
    const rest = keys.filter((k) => !ordered.includes(k));
    return [...ordered, ...rest.sort()];
  }
  return keys.sort((a, b) => {
    const ia = PREFERRED_SPEC_ORDER.findIndex((p) => a.toLowerCase().includes(p.toLowerCase()) || p.toLowerCase().includes(a.toLowerCase()));
    const ib = PREFERRED_SPEC_ORDER.findIndex((p) => b.toLowerCase().includes(p.toLowerCase()) || p.toLowerCase().includes(b.toLowerCase()));
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
}

export function catalogItemImageList(item: { imageUrl?: string; storeGalleryUrls?: string[] }): string[] {
  const raw: string[] = [];
  if (item.imageUrl) raw.push(item.imageUrl);
  if (item.storeGalleryUrls?.length) raw.push(...item.storeGalleryUrls);
  return filterUsableImageUrls(raw);
}

export function priceDisplay(item: StoreItem) {
  const sale = item.storeOnSale && item.storeSalePrice != null;
  const value = sale ? item.storeSalePrice! : (item.sellPrice ?? undefined);
  const hasPrice = value != null && value > 0;
  return { value: value ?? 0, sale, hasPrice };
}

export type SortOption = 'default' | 'priceAsc' | 'priceDesc' | 'nameAsc';

export interface FilterState {
  tab: 'all' | 'sale';
  categoryFilter: string;
  subCategoryFilter: string;
  minPrice: string;
  maxPrice: string;
  search: string;
  sortBy: SortOption;
  viewMode: 'grid' | 'list';
}

export function hasActiveFilters(f: FilterState): boolean {
  return f.tab === 'sale' || !!f.categoryFilter || !!f.subCategoryFilter || f.minPrice !== '' || f.maxPrice !== '' || f.search.trim() !== '';
}

export function clearFilters(): Partial<FilterState> {
  return {
    tab: 'all',
    categoryFilter: '',
    subCategoryFilter: '',
    minPrice: '',
    maxPrice: '',
    search: '',
  };
}
