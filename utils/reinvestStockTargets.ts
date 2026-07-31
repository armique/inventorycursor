/**
 * Reinvest shelf watchlist — default hot-sellers + user-added SKUs.
 * Counts live IN_STOCK (standalone parts; kits for special builtins).
 */
import { ItemStatus, type InventoryItem } from '../types';
import { getChildren } from '../services/financialAggregation';
import {
  extractPrimaryComponentKey,
  prettifyComponentKey,
  type ComponentCategory,
} from './componentKeyExtractor';

const CATEGORY_LABELS: Record<ComponentCategory, string> = {
  gpu: 'GPU',
  cpu: 'CPU',
  ram: 'RAM',
  storage: 'Storage',
  motherboard: 'Motherboard',
  psu: 'PSU',
  case: 'Case',
  cooler: 'Cooler',
};

export const DEFAULT_STOCK_TARGET = 3;

const STORAGE_KEY = 'reinvest_stock_watchlist_v1';

export type StockWatchMatch =
  | { kind: 'builtin'; builtinId: string }
  | { kind: 'componentKey'; componentKey: string }
  | { kind: 'query'; query: string };

export type StockWatchEntry = {
  id: string;
  label: string;
  hint?: string;
  categoryLabel?: string;
  target: number;
  match: StockWatchMatch;
};

export type StockTargetRow = StockWatchEntry & {
  current: number;
  need: number;
  excess: number;
};

export type StockWatchSuggestion = {
  key: string;
  label: string;
  hint?: string;
  categoryLabel: string;
  match: StockWatchMatch;
};

function haystack(item: InventoryItem): string {
  return [item.name, item.subCategory, item.category, item.marketTitle, item.comment1]
    .filter(Boolean)
    .join(' ');
}

function isActiveStock(item: InventoryItem): boolean {
  return item.status === ItemStatus.IN_STOCK;
}

function nestedChildIds(items: InventoryItem[]): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    if (!item.isBundle && !item.isPC) continue;
    for (const child of getChildren(item, items)) ids.add(child.id);
  }
  return ids;
}

function standaloneStock(items: InventoryItem[]): InventoryItem[] {
  const nested = nestedChildIds(items);
  return items.filter((i) => isActiveStock(i) && !nested.has(i.id) && !i.isBundle && !i.isPC);
}

function storageCapacityGb(item: InventoryItem): number | null {
  const match = extractPrimaryComponentKey(haystack(item));
  if (!match || match.category !== 'storage') return null;
  if (!/^storage:(ssd|nvme)/.test(match.componentKey)) return null;
  const m = match.componentKey.match(/-(\d+)(gb|tb)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === 'tb' ? n * 1024 : n;
}

function gpuKey(item: InventoryItem): string | null {
  const match = extractPrimaryComponentKey(haystack(item));
  if (!match || match.category !== 'gpu') return null;
  return match.componentKey;
}

function is4790k(item: InventoryItem): boolean {
  const key = extractPrimaryComponentKey(haystack(item))?.componentKey || '';
  if (key === 'cpu:i7-4790k') return true;
  return /\bi7[\s-]*4790\s*k\b/i.test(haystack(item));
}

const LGA1150_CHIPSETS = /\b(z97|h97|b85|h81|z87|q87|h87|b75|q85|z97x)\b/i;

function isLga1150Mobo(item: InventoryItem): boolean {
  const text = haystack(item);
  if (LGA1150_CHIPSETS.test(text) || /\blga\s*1150\b/i.test(text)) {
    const cat = extractPrimaryComponentKey(text)?.category;
    if (cat === 'motherboard' || /\b(mainboard|motherboard|platine)\b/i.test(text)) return true;
    if (LGA1150_CHIPSETS.test(text)) return true;
  }
  const match = extractPrimaryComponentKey(text);
  return match?.category === 'motherboard' && /\b(1150|haswell|4790)\b/i.test(text);
}

const AM4_CHIPSETS = /\b(b450|b550|x470|x570|a520|b350|x370|a320|b550m|b450m)\b/i;

function isAm4Cpu(item: InventoryItem): boolean {
  const text = haystack(item);
  if (/\bam4\b/i.test(text) && /\b(ryzen|cpu|prozessor)\b/i.test(text)) return true;
  const key = extractPrimaryComponentKey(text)?.componentKey || '';
  let m = key.match(/^cpu:ryzen([1-5])-/);
  if (m) return true;
  m = key.match(/^cpu:ryzen-([1-5]\d{3})/);
  if (m) return true;
  m = text.toLowerCase().match(/\bryzen\s*[3579]?\s*([1-5]\d{3}[a-z0-9]*)\b/);
  return Boolean(m);
}

function isAm4Mobo(item: InventoryItem): boolean {
  const text = haystack(item);
  if (AM4_CHIPSETS.test(text) || /\bam4\b/i.test(text)) {
    const cat = extractPrimaryComponentKey(text)?.category;
    if (cat === 'motherboard' || /\b(mainboard|motherboard|platine)\b/i.test(text) || AM4_CHIPSETS.test(text)) {
      return true;
    }
  }
  return false;
}

function containerHas4790k(container: InventoryItem, items: InventoryItem[]): boolean {
  const kids = getChildren(container, items);
  if (kids.some(is4790k)) return true;
  return is4790k(container) || /\b4790\s*k\b/i.test(haystack(container));
}

function containerIsAm4Bundle(container: InventoryItem, items: InventoryItem[]): boolean {
  const kids = getChildren(container, items);
  if (/\bam4\b/i.test(haystack(container))) return true;
  const hasAm4Cpu = kids.some(isAm4Cpu) || isAm4Cpu(container);
  const hasAm4Mobo = kids.some(isAm4Mobo) || isAm4Mobo(container);
  return hasAm4Cpu && (hasAm4Mobo || kids.length >= 2 || Boolean(container.isPC));
}

function countSsdTier(items: InventoryItem[], gb: number): number {
  return standaloneStock(items).filter((i) => storageCapacityGb(i) === gb).length;
}

function countGpuExact(items: InventoryItem[], key: string): number {
  return standaloneStock(items).filter((i) => gpuKey(i) === key).length;
}

function countMobo4790kKits(items: InventoryItem[]): number {
  const parts = standaloneStock(items);
  const cpus = parts.filter(is4790k).length;
  const mobos = parts.filter(isLga1150Mobo).length;
  const built = items.filter(
    (i) => isActiveStock(i) && (i.isBundle || i.isPC) && containerHas4790k(i, items),
  ).length;
  return built + Math.min(cpus, mobos);
}

function countAm4Bundles(items: InventoryItem[]): number {
  const parts = standaloneStock(items);
  const cpus = parts.filter(isAm4Cpu).length;
  const mobos = parts.filter(isAm4Mobo).length;
  const built = items.filter(
    (i) => isActiveStock(i) && (i.isBundle || i.isPC) && containerIsAm4Bundle(i, items),
  ).length;
  return built + Math.min(cpus, mobos);
}

function countByComponentKey(items: InventoryItem[], componentKey: string): number {
  return standaloneStock(items).filter((i) => {
    const m = extractPrimaryComponentKey(haystack(i));
    return m?.componentKey === componentKey;
  }).length;
}

function countByQuery(items: InventoryItem[], query: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  return standaloneStock(items).filter((i) => haystack(i).toLowerCase().includes(q)).length;
}

type BuiltinDef = {
  id: string;
  label: string;
  hint: string;
  categoryLabel: string;
  count: (items: InventoryItem[]) => number;
};

const BUILTINS: BuiltinDef[] = [
  {
    id: 'ssd-256',
    label: 'SSD 256GB',
    hint: 'incl. 240GB',
    categoryLabel: 'Storage',
    count: (items) => countSsdTier(items, 256),
  },
  {
    id: 'ssd-512',
    label: 'SSD 512GB',
    hint: 'incl. 480 / 500GB',
    categoryLabel: 'Storage',
    count: (items) => countSsdTier(items, 512),
  },
  {
    id: 'ssd-1tb',
    label: 'SSD 1TB',
    hint: 'NVMe or SATA',
    categoryLabel: 'Storage',
    count: (items) => countSsdTier(items, 1024),
  },
  {
    id: 'ssd-2tb',
    label: 'SSD 2TB',
    hint: 'NVMe or SATA',
    categoryLabel: 'Storage',
    count: (items) => countSsdTier(items, 2048),
  },
  {
    id: 'mobo-4790k',
    label: 'Mobo + 4790K',
    hint: 'any LGA1150 + i7-4790K',
    categoryLabel: 'Bundle',
    count: countMobo4790kKits,
  },
  {
    id: 'am4-bundle',
    label: 'AM4 bundle',
    hint: 'any AM4 CPU + board',
    categoryLabel: 'Bundle',
    count: countAm4Bundles,
  },
  {
    id: 'gtx-1080',
    label: 'GTX 1080',
    hint: 'non-Ti',
    categoryLabel: 'GPU',
    count: (items) => countGpuExact(items, 'gpu:gtx1080'),
  },
  {
    id: 'rtx-2080',
    label: 'RTX 2080',
    hint: 'non-Ti',
    categoryLabel: 'GPU',
    count: (items) => countGpuExact(items, 'gpu:rtx2080'),
  },
  {
    id: 'rtx-3070',
    label: 'RTX 3070',
    hint: 'non-Ti',
    categoryLabel: 'GPU',
    count: (items) => countGpuExact(items, 'gpu:rtx3070'),
  },
];

const BUILTIN_BY_ID = new Map(BUILTINS.map((b) => [b.id, b]));

export function defaultStockWatchEntries(target = DEFAULT_STOCK_TARGET): StockWatchEntry[] {
  return BUILTINS.map((b) => ({
    id: `builtin:${b.id}`,
    label: b.label,
    hint: b.hint,
    categoryLabel: b.categoryLabel,
    target,
    match: { kind: 'builtin', builtinId: b.id },
  }));
}

function sanitizeEntry(raw: unknown): StockWatchEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id || '').trim();
  const label = String(o.label || '').trim();
  const target = Math.max(0, Math.min(99, Math.round(Number(o.target) || DEFAULT_STOCK_TARGET)));
  if (!id || !label) return null;
  const matchRaw = o.match as Record<string, unknown> | undefined;
  if (!matchRaw || typeof matchRaw !== 'object') return null;
  const kind = String(matchRaw.kind || '');
  let match: StockWatchMatch | null = null;
  if (kind === 'builtin' && matchRaw.builtinId) {
    match = { kind: 'builtin', builtinId: String(matchRaw.builtinId) };
  } else if (kind === 'componentKey' && matchRaw.componentKey) {
    match = { kind: 'componentKey', componentKey: String(matchRaw.componentKey) };
  } else if (kind === 'query' && matchRaw.query) {
    match = { kind: 'query', query: String(matchRaw.query) };
  }
  if (!match) return null;
  return {
    id,
    label,
    hint: o.hint != null ? String(o.hint) : undefined,
    categoryLabel: o.categoryLabel != null ? String(o.categoryLabel) : undefined,
    target,
    match,
  };
}

export function loadStockWatchEntries(): StockWatchEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultStockWatchEntries();
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed?.entries;
    if (!Array.isArray(list)) return defaultStockWatchEntries();
    const out = list.map(sanitizeEntry).filter((e): e is StockWatchEntry => Boolean(e));
    return out.length ? out : defaultStockWatchEntries();
  } catch {
    return defaultStockWatchEntries();
  }
}

export function saveStockWatchEntries(entries: StockWatchEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ entries }));
  } catch {
    /* quota / private mode */
  }
}

export function countForWatchEntry(entry: StockWatchEntry, items: InventoryItem[]): number {
  if (entry.match.kind === 'builtin') {
    const def = BUILTIN_BY_ID.get(entry.match.builtinId);
    return def ? def.count(items) : 0;
  }
  if (entry.match.kind === 'componentKey') {
    return countByComponentKey(items, entry.match.componentKey);
  }
  return countByQuery(items, entry.match.query);
}

export function computeWatchRows(entries: StockWatchEntry[], items: InventoryItem[]): StockTargetRow[] {
  return entries.map((entry) => {
    const current = countForWatchEntry(entry, items);
    const target = Math.max(0, entry.target);
    return {
      ...entry,
      current,
      need: Math.max(0, target - current),
      excess: Math.max(0, current - target),
    };
  });
}

function categoryLabelForKey(componentKey: string): string {
  const cat = componentKey.split(':')[0] as ComponentCategory;
  return CATEGORY_LABELS[cat] || 'Parts';
}

function matchKey(match: StockWatchMatch): string {
  if (match.kind === 'builtin') return `builtin:${match.builtinId}`;
  if (match.kind === 'componentKey') return `ck:${match.componentKey}`;
  return `q:${match.query.toLowerCase()}`;
}

/** Type-ahead: parse a free-text name into a trackable category/SKU suggestion. */
export function suggestStockWatch(
  query: string,
  items: InventoryItem[],
  existing: StockWatchEntry[],
): StockWatchSuggestion[] {
  const q = query.trim();
  if (q.length < 2) return [];
  const taken = new Set(existing.map((e) => matchKey(e.match)));
  const out: StockWatchSuggestion[] = [];
  const push = (s: StockWatchSuggestion) => {
    const k = matchKey(s.match);
    if (taken.has(k) || out.some((x) => matchKey(x.match) === k)) return;
    out.push(s);
  };

  const qLower = q.toLowerCase();

  for (const b of BUILTINS) {
    if (
      b.label.toLowerCase().includes(qLower) ||
      b.hint.toLowerCase().includes(qLower) ||
      b.id.includes(qLower.replace(/\s+/g, '-'))
    ) {
      push({
        key: `builtin:${b.id}`,
        label: b.label,
        hint: b.hint,
        categoryLabel: b.categoryLabel,
        match: { kind: 'builtin', builtinId: b.id },
      });
    }
  }

  const parsed = extractPrimaryComponentKey(q);
  if (parsed && (parsed.confidence === 'high' || parsed.confidence === 'medium')) {
    const label = prettifyComponentKey(parsed.componentKey) || q;
    push({
      key: `ck:${parsed.componentKey}`,
      label,
      hint: parsed.componentKey,
      categoryLabel: categoryLabelForKey(parsed.componentKey),
      match: { kind: 'componentKey', componentKey: parsed.componentKey },
    });
  }

  // Inventory hits — group by primary component key when possible.
  const stock = standaloneStock(items);
  const byKey = new Map<string, { label: string; count: number; componentKey?: string }>();
  for (const item of stock) {
    const text = haystack(item);
    if (!text.toLowerCase().includes(qLower)) continue;
    const m = extractPrimaryComponentKey(text);
    if (m) {
      const prev = byKey.get(m.componentKey) || {
        label: prettifyComponentKey(m.componentKey) || item.name,
        count: 0,
        componentKey: m.componentKey,
      };
      prev.count += 1;
      byKey.set(m.componentKey, prev);
    } else {
      const nameKey = `name:${item.name.toLowerCase().slice(0, 48)}`;
      const prev = byKey.get(nameKey) || { label: item.name, count: 0 };
      prev.count += 1;
      byKey.set(nameKey, prev);
    }
  }

  const ranked = [...byKey.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8);

  for (const [key, info] of ranked) {
    if (info.componentKey) {
      push({
        key: `ck:${info.componentKey}`,
        label: info.label,
        hint: `${info.count} in stock`,
        categoryLabel: categoryLabelForKey(info.componentKey),
        match: { kind: 'componentKey', componentKey: info.componentKey },
      });
    } else {
      const queryMatch = info.label.trim();
      push({
        key: `q:${queryMatch.toLowerCase()}`,
        label: queryMatch,
        hint: `${info.count} in stock · name match`,
        categoryLabel: 'Custom',
        match: { kind: 'query', query: queryMatch },
      });
    }
    if (out.length >= 10) break;
  }

  // Always offer raw name match as last resort.
  if (out.length === 0 || !parsed) {
    push({
      key: `q:${qLower}`,
      label: q,
      hint: 'name contains',
      categoryLabel: 'Custom',
      match: { kind: 'query', query: q },
    });
  }

  return out.slice(0, 10);
}

export function entryFromSuggestion(
  suggestion: StockWatchSuggestion,
  target = DEFAULT_STOCK_TARGET,
): StockWatchEntry {
  return {
    id: suggestion.key,
    label: suggestion.label,
    hint: suggestion.hint,
    categoryLabel: suggestion.categoryLabel,
    target,
    match: suggestion.match,
  };
}

/** @deprecated use computeWatchRows */
export function computeReinvestStockTargets(
  items: InventoryItem[],
  target = DEFAULT_STOCK_TARGET,
): StockTargetRow[] {
  return computeWatchRows(defaultStockWatchEntries(target), items);
}

/** @deprecated use computeWatchRows + filter need */
export function computeReinvestStockGaps(
  items: InventoryItem[],
  target = DEFAULT_STOCK_TARGET,
): StockTargetRow[] {
  return computeReinvestStockTargets(items, target).filter((r) => r.need > 0);
}
