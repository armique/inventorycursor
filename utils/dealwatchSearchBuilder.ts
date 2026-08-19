import { HARDWARE_OPTIONS } from '../services/hardwareDB';
import type { DealwatchMarketplace, DealwatchSearch } from '../services/dealwatchApi';

export const SEARCH_BUILDER_STORAGE_KEY = 'dealwatch_search_builder_v1';
export const MAX_SPEC_PILLS = 6;
export const PRICE_QUICK_CHIPS = [20, 40, 60, 80, 100, 150];
export const KA_RADIUS_OPTIONS = [0, 5, 10, 20, 30, 50, 60, 100, 150, 200];
export const KA_HOME = { locationId: '6699', locationLabel: '89367 Waldstetten' };
export const PRICE_SLIDER_MAX = 500;

export type BuilderPill = { id: string; label: string };

export type BuilderCategory = {
  id: string;
  label: string;
  seed: string;
  facets: BuilderPill[];
};

export type BuilderLibrary = { categories: BuilderCategory[] };

export type SearchBuilderSelection = {
  categoryId: string;
  facetIds: string[];
};

export type SearchBuilderDraft = SearchBuilderSelection & {
  minPrice: number;
  maxPrice: number;
  radiusKm: number;
  marketplace: DealwatchMarketplace;
};

export type CompiledSearchBuilder = {
  search: string;
  searchVariants: string[];
  name: string;
  minPrice: number;
  maxPrice: number;
  radiusKm: number;
  locationId: string;
  locationLabel: string;
  marketplace: DealwatchMarketplace;
  constructor: SearchBuilderSelection;
};

export function specBrand(label: string): 'intel' | 'amd' | null {
  const t = String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  if (!t) return null;
  if (/^(lga|1150|1151|1155|1200|1700|1851|2011|2066)/.test(t)) return 'intel';
  if (/^(coreultra|corei[3579]|i[3579])/.test(t)) return 'intel';
  if (/^(am\d|tr4|strx|fm\d|ryzen|threadripper)/.test(t)) return 'amd';
  if (/^(z|h|q|w)\d/.test(t)) return 'intel';
  if (/^b(36|46|56|66|76|86)/.test(t)) return 'intel';
  if (/^x(79|99|299)/.test(t)) return 'intel';
  if (/^[ax]\d/.test(t)) return 'amd';
  if (/^b(35|45|55|65)/.test(t)) return 'amd';
  return null;
}

export function slugifyPill(label: string): string {
  const slug = String(label || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `pill-${Date.now()}`;
}

function pills(labels: string[]): BuilderPill[] {
  const seen = new Set<string>();
  const out: BuilderPill[] = [];
  for (const raw of labels) {
    const label = String(raw || '').trim();
    if (!label) continue;
    const id = slugifyPill(label);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label });
  }
  return out;
}

export function defaultBuilderLibrary(): BuilderLibrary {
  return {
    categories: [
      {
        id: 'motherboard',
        label: 'Motherboard',
        seed: 'mainboard',
        facets: pills([
          ...HARDWARE_OPTIONS.motherboard.chipsets,
          'AM4',
          'AM5',
          'LGA 1700',
          'LGA 1200',
          'LGA 1151',
          'ATX',
          'mATX',
          'ITX',
        ]),
      },
      {
        id: 'cpu',
        label: 'CPU',
        seed: 'prozessor',
        facets: pills([
          ...HARDWARE_OPTIONS.cpu.sockets,
          'Ryzen 5',
          'Ryzen 7',
          'Ryzen 9',
          'i5',
          'i7',
          'i9',
        ]),
      },
      {
        id: 'gpu',
        label: 'GPU',
        seed: 'grafikkarte',
        facets: pills([
          'GTX 1060',
          'GTX 1070',
          'GTX 1080',
          '1080 Ti',
          'RTX 2060',
          'RTX 2070',
          'RTX 2080',
          'RTX 3060',
          'RTX 3070',
          'RTX 3080',
          'RTX 4060',
          'RTX 4070',
          'RX 580',
          'RX 6600',
        ]),
      },
      {
        id: 'ram',
        label: 'RAM',
        seed: 'ram',
        facets: pills(['DDR3', 'DDR4', 'DDR5', '8GB', '16GB', '32GB', 'SODIMM']),
      },
      {
        id: 'ssd',
        label: 'SSD',
        seed: 'ssd',
        facets: pills(['NVMe', 'SATA', 'M.2', '256GB', '512GB', '1TB', '2TB']),
      },
      {
        id: 'psu',
        label: 'PSU',
        seed: 'netzteil',
        facets: pills(['500W', '650W', '750W', '850W', 'modular']),
      },
    ],
  };
}

export function emptySearchBuilderDraft(): SearchBuilderDraft {
  return {
    categoryId: 'motherboard',
    facetIds: [],
    minPrice: 1,
    maxPrice: 80,
    radiusKm: 0,
    marketplace: 'ebay',
  };
}

function cloneLibrary(library: BuilderLibrary): BuilderLibrary {
  return {
    categories: (library.categories || []).map((cat) => ({
      ...cat,
      facets: (cat.facets || []).map((f) => ({ ...f })),
    })),
  };
}

export function findBuilderCategory(
  library: BuilderLibrary,
  categoryId?: string | null
): BuilderCategory | undefined {
  return (library.categories || []).find((c) => c.id === categoryId);
}

export function addBuilderCategory(library: BuilderLibrary, label: string): BuilderLibrary {
  const trimmed = label.trim();
  if (!trimmed) return library;
  const next = cloneLibrary(library);
  let id = slugifyPill(trimmed);
  if (next.categories.some((c) => c.id === id)) id = `${id}-${Date.now().toString(36)}`;
  next.categories.push({
    id,
    label: trimmed,
    seed: trimmed.toLowerCase(),
    facets: [],
  });
  return next;
}

export function renameBuilderCategory(
  library: BuilderLibrary,
  categoryId: string,
  label: string
): BuilderLibrary {
  const trimmed = label.trim();
  if (!trimmed) return library;
  const next = cloneLibrary(library);
  const cat = next.categories.find((c) => c.id === categoryId);
  if (!cat) return library;
  cat.label = trimmed;
  return next;
}

export function removeBuilderCategory(library: BuilderLibrary, categoryId: string): BuilderLibrary {
  return { categories: (library.categories || []).filter((c) => c.id !== categoryId) };
}

export function addBuilderFacet(
  library: BuilderLibrary,
  categoryId: string,
  label: string
): BuilderLibrary {
  const trimmed = label.trim();
  if (!trimmed) return library;
  const next = cloneLibrary(library);
  const cat = next.categories.find((c) => c.id === categoryId);
  if (!cat) return library;
  let id = slugifyPill(trimmed);
  if (cat.facets.some((f) => f.id === id)) id = `${id}-${Date.now().toString(36)}`;
  cat.facets.push({ id, label: trimmed });
  return next;
}

export function renameBuilderFacet(
  library: BuilderLibrary,
  categoryId: string,
  facetId: string,
  label: string
): BuilderLibrary {
  const trimmed = label.trim();
  if (!trimmed) return library;
  const next = cloneLibrary(library);
  const cat = next.categories.find((c) => c.id === categoryId);
  const facet = cat?.facets.find((f) => f.id === facetId);
  if (!facet) return library;
  facet.label = trimmed;
  return next;
}

export function removeBuilderFacet(
  library: BuilderLibrary,
  categoryId: string,
  facetId: string
): BuilderLibrary {
  const next = cloneLibrary(library);
  const cat = next.categories.find((c) => c.id === categoryId);
  if (!cat) return library;
  cat.facets = cat.facets.filter((f) => f.id !== facetId);
  return next;
}

export function snapKaRadius(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return KA_RADIUS_OPTIONS.reduce((best, opt) =>
    Math.abs(opt - n) < Math.abs(best - n) ? opt : best
  );
}

function clampPrice(value: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(5000, Math.max(1, Math.round(n)));
}

export function compileSearchBuilder(
  draft: SearchBuilderDraft,
  library: BuilderLibrary
): CompiledSearchBuilder {
  const cat =
    findBuilderCategory(library, draft.categoryId) || library.categories[0] || {
      id: 'motherboard',
      label: 'Motherboard',
      seed: 'mainboard',
      facets: [],
    };
  const byId = new Map((cat.facets || []).map((f) => [f.id, f]));
  const selected = draft.facetIds
    .map((id) => byId.get(id))
    .filter((f): f is NonNullable<typeof f> => Boolean(f))
    .slice(0, MAX_SPEC_PILLS);
  const seed = cat.seed.trim();
  const searchVariants = selected.length
    ? selected.map((f) => [f.label, seed].filter(Boolean).join(' ').trim()).filter(Boolean)
    : seed
      ? [seed]
      : [];
  const uniqueVariants = [...new Set(searchVariants)].slice(0, MAX_SPEC_PILLS);
  const minPrice = clampPrice(draft.minPrice, 1);
  let maxPrice = clampPrice(draft.maxPrice, 80);
  if (minPrice > maxPrice) maxPrice = minPrice;
  const marketplace: DealwatchMarketplace =
    draft.marketplace === 'kleinanzeigen' ? 'kleinanzeigen' : 'ebay';
  const radiusKm = marketplace === 'kleinanzeigen' ? snapKaRadius(draft.radiusKm) : 0;
  const location = marketplace === 'kleinanzeigen' && radiusKm > 0 ? KA_HOME : { locationId: '', locationLabel: '' };
  const specLabels = selected.map((f) => f.label);
  const nameParts = [
    cat.label,
    specLabels.length ? specLabels.join(' · ') : '',
    `€${minPrice}–${maxPrice}`,
    marketplace === 'kleinanzeigen' && radiusKm > 0 ? `${radiusKm}km` : '',
  ].filter(Boolean);
  return {
    search: uniqueVariants.join('|'),
    searchVariants: uniqueVariants,
    name: nameParts.join(' · ').slice(0, 80),
    minPrice,
    maxPrice,
    radiusKm,
    locationId: location.locationId,
    locationLabel: location.locationLabel,
    marketplace,
    constructor: {
      categoryId: cat.id,
      facetIds: selected.map((f) => f.id),
    },
  };
}

export function readSearchConstructor(search: DealwatchSearch | null | undefined): SearchBuilderSelection | null {
  if (!search || typeof search !== 'object') return null;
  if (!Object.prototype.hasOwnProperty.call(search, 'constructor')) return null;
  const raw = (search as DealwatchSearch & { constructor?: unknown }).constructor;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw === 'function') return null;
  const rec = raw as { categoryId?: unknown; facetIds?: unknown };
  const categoryId = String(rec.categoryId || '').trim();
  if (!categoryId) return null;
  const facetIds = Array.isArray(rec.facetIds)
    ? [...new Set(rec.facetIds.map((id) => String(id || '').trim()).filter(Boolean))].slice(0, MAX_SPEC_PILLS)
    : [];
  return { categoryId, facetIds };
}

function tokensFromSearch(search: DealwatchSearch): string[] {
  const variants = Array.isArray(search.searchVariants)
    ? search.searchVariants.map((v) => String(v || '').trim()).filter(Boolean)
    : [];
  if (variants.length) return variants;
  const raw = String(search.search || '').trim();
  if (!raw) return [];
  if (raw.includes('|')) return raw.split('|').map((p) => p.trim()).filter(Boolean);
  return [raw];
}

export function draftFromSearch(
  search: DealwatchSearch | null | undefined,
  library: BuilderLibrary
): SearchBuilderDraft {
  const base = emptySearchBuilderDraft();
  if (!search) return base;
  const stored = readSearchConstructor(search);
  let categoryId = stored?.categoryId || '';
  let facetIds = stored?.facetIds || [];
  if (!categoryId) {
    const blob = tokensFromSearch(search).join(' ').toLowerCase();
    const bySeed = library.categories.find((c) => blob.includes(c.seed.toLowerCase()));
    const byLabel = library.categories.find((c) => blob.includes(c.label.toLowerCase()));
    categoryId = (bySeed || byLabel)?.id || library.categories[0]?.id || base.categoryId;
    const cat = findBuilderCategory(library, categoryId);
    if (cat) {
      facetIds = cat.facets
        .filter((f) => blob.includes(f.label.toLowerCase()))
        .map((f) => f.id)
        .slice(0, MAX_SPEC_PILLS);
    }
  }
  return {
    categoryId,
    facetIds,
    minPrice: clampPrice(search.minPrice ?? 1, 1),
    maxPrice: clampPrice(search.maxPrice ?? 80, 80),
    radiusKm: snapKaRadius(search.radiusKm ?? 0),
    marketplace: search.marketplace === 'kleinanzeigen' ? 'kleinanzeigen' : 'ebay',
  };
}

export function ensureLibraryHasSelection(
  library: BuilderLibrary,
  selection: SearchBuilderSelection
): BuilderLibrary {
  const next = cloneLibrary(library);
  if (!selection.categoryId) return next;
  let cat = next.categories.find((c) => c.id === selection.categoryId);
  if (!cat) {
    cat = {
      id: selection.categoryId,
      label: selection.categoryId.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()),
      seed: selection.categoryId.replace(/-/g, ' '),
      facets: [],
    };
    next.categories.push(cat);
  }
  for (const facetId of selection.facetIds || []) {
    if (cat.facets.some((f) => f.id === facetId)) continue;
    cat.facets.push({
      id: facetId,
      label: facetId.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()),
    });
  }
  return next;
}

export function isBuilderDirty(
  draft: SearchBuilderDraft,
  library: BuilderLibrary,
  saved: DealwatchSearch | null | undefined
): boolean {
  if (!saved) return true;
  const compiled = compileSearchBuilder(draft, library);
  const savedVariants = [...(saved.searchVariants || [])].map((v) => v.trim()).filter(Boolean);
  const sameVariants =
    compiled.searchVariants.length === savedVariants.length &&
    compiled.searchVariants.every((v, i) => v === savedVariants[i]);
  const savedCtor = readSearchConstructor(saved);
  const ctorDirty = savedCtor
    ? savedCtor.categoryId !== compiled.constructor.categoryId ||
      JSON.stringify(savedCtor.facetIds) !== JSON.stringify(compiled.constructor.facetIds)
    : false;
  return (
    compiled.search !== String(saved.search || '') ||
    !sameVariants ||
    compiled.minPrice !== clampPrice(saved.minPrice ?? 1, 1) ||
    compiled.maxPrice !== clampPrice(saved.maxPrice ?? 80, 80) ||
    compiled.radiusKm !== snapKaRadius(saved.radiusKm ?? 0) ||
    compiled.marketplace !== (saved.marketplace === 'kleinanzeigen' ? 'kleinanzeigen' : 'ebay') ||
    ctorDirty
  );
}

export function loadBuilderLibrary(): BuilderLibrary {
  const fallback = defaultBuilderLibrary();
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(SEARCH_BUILDER_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as BuilderLibrary;
    if (!Array.isArray(parsed?.categories) || !parsed.categories.length) return fallback;
    const cats = parsed.categories
      .map((cat) => ({
        id: String(cat.id || slugifyPill(cat.label || '')),
        label: String(cat.label || cat.id || '').trim(),
        seed: String(cat.seed || cat.label || '').trim().toLowerCase(),
        facets: Array.isArray(cat.facets)
          ? cat.facets
              .map((f) => ({
                id: String(f.id || slugifyPill(f.label || '')),
                label: String(f.label || f.id || '').trim(),
              }))
              .filter((f) => f.id && f.label)
          : [],
      }))
      .filter((c) => c.id && c.label);
    return cats.length ? { categories: cats } : fallback;
  } catch {
    return fallback;
  }
}

export function saveBuilderLibrary(library: BuilderLibrary): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SEARCH_BUILDER_STORAGE_KEY, JSON.stringify(library));
  } catch {
    /* quota / private mode */
  }
}
