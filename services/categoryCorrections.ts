const STORAGE_KEY = 'category_corrections_v1';

export type CategoryCorrection = {
  fromName: string;
  toCategory: string;
  count: number;
  lastUsed: string;
};

export function loadCategoryCorrections(): CategoryCorrection[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Remember when user fixes AI-suggested category (#96). */
export function recordCategoryCorrection(itemName: string, toCategory: string): void {
  const key = itemName.trim().toLowerCase();
  if (!key || !toCategory) return;
  const list = loadCategoryCorrections();
  const idx = list.findIndex((c) => c.fromName.toLowerCase() === key);
  const entry: CategoryCorrection = {
    fromName: itemName.trim(),
    toCategory,
    count: idx >= 0 ? list[idx].count + 1 : 1,
    lastUsed: new Date().toISOString(),
  };
  if (idx >= 0) list[idx] = entry;
  else list.unshift(entry);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 200)));
}

export function suggestCategoryFromCorrections(itemName: string): string | null {
  const key = itemName.trim().toLowerCase();
  const hit = loadCategoryCorrections().find((c) => key.includes(c.fromName.toLowerCase()) || c.fromName.toLowerCase().includes(key));
  return hit?.toCategory ?? null;
}
