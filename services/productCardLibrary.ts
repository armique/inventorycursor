import type { ProductCardTemplate } from './productCardTemplates';

export interface SavedProductCardDesign {
  id: string;
  template: ProductCardTemplate;
  savedAt: string;
  /** Compressed preview for library grid */
  previewDataUrl?: string;
  sourceItemId?: string;
  sourceItemName?: string;
  notes?: string;
}

const LIBRARY_KEY = 'product_card_design_library_v1';
const MAX_LIBRARY = 48;

export function loadProductCardLibrary(): SavedProductCardDesign[] {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistLibrary(entries: SavedProductCardDesign[]) {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(entries.slice(0, MAX_LIBRARY)));
}

export function saveToProductCardLibrary(entry: Omit<SavedProductCardDesign, 'id' | 'savedAt'> & { id?: string }): SavedProductCardDesign {
  const lib = loadProductCardLibrary();
  const saved: SavedProductCardDesign = {
    id: entry.id || `design-${Date.now()}`,
    template: entry.template,
    savedAt: new Date().toISOString(),
    previewDataUrl: entry.previewDataUrl,
    sourceItemId: entry.sourceItemId,
    sourceItemName: entry.sourceItemName,
    notes: entry.notes,
  };
  persistLibrary([saved, ...lib.filter((d) => d.id !== saved.id)]);
  return saved;
}

export function deleteFromProductCardLibrary(id: string): SavedProductCardDesign[] {
  const next = loadProductCardLibrary().filter((d) => d.id !== id);
  persistLibrary(next);
  return next;
}

export function updateProductCardLibraryNotes(id: string, notes: string): SavedProductCardDesign[] {
  const next = loadProductCardLibrary().map((d) => (d.id === id ? { ...d, notes } : d));
  persistLibrary(next);
  return next;
}

export function getProductCardLibraryStats() {
  const lib = loadProductCardLibrary();
  const byProvider: Record<string, number> = {};
  for (const d of lib) {
    const p = d.template.aiMeta?.provider || 'Manual';
    byProvider[p] = (byProvider[p] || 0) + 1;
  }
  return { total: lib.length, byProvider };
}
