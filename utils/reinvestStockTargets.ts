/**
 * Fixed hot-sellers the shop wants on the shelf — target qty defaults to 3 each.
 * Stock is counted from current IN_STOCK inventory (standalone parts + assemblable kits).
 */
import { ItemStatus, type InventoryItem } from '../types';
import { getChildren } from '../services/financialAggregation';
import { extractPrimaryComponentKey } from './componentKeyExtractor';

export const DEFAULT_STOCK_TARGET = 3;

export type StockTargetRow = {
  id: string;
  label: string;
  hint: string;
  current: number;
  target: number;
  need: number;
};

function haystack(item: InventoryItem): string {
  return [item.name, item.subCategory, item.category, item.marketTitle, item.comment1]
    .filter(Boolean)
    .join(' ');
}

function isActiveStock(item: InventoryItem): boolean {
  return item.status === ItemStatus.IN_STOCK;
}

/** Child ids belonging to any bundle/PC — avoid double-counting parts already inside a kit. */
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
  // SSD / NVMe only — HDDs are not restock targets here.
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

type TargetDef = {
  id: string;
  label: string;
  hint: string;
  count: (items: InventoryItem[]) => number;
};

const TARGETS: TargetDef[] = [
  {
    id: 'ssd-256',
    label: 'SSD 256GB',
    hint: 'incl. 240GB',
    count: (items) => countSsdTier(items, 256),
  },
  {
    id: 'ssd-512',
    label: 'SSD 512GB',
    hint: 'incl. 480 / 500GB',
    count: (items) => countSsdTier(items, 512),
  },
  {
    id: 'ssd-1tb',
    label: 'SSD 1TB',
    hint: 'NVMe or SATA',
    count: (items) => countSsdTier(items, 1024),
  },
  {
    id: 'ssd-2tb',
    label: 'SSD 2TB',
    hint: 'NVMe or SATA',
    count: (items) => countSsdTier(items, 2048),
  },
  {
    id: 'mobo-4790k',
    label: 'Mobo + 4790K',
    hint: 'any LGA1150 board + i7-4790K',
    count: countMobo4790kKits,
  },
  {
    id: 'am4-bundle',
    label: 'AM4 bundle',
    hint: 'any AM4 CPU + board kit',
    count: countAm4Bundles,
  },
  {
    id: 'gtx-1080',
    label: 'GTX 1080',
    hint: 'non-Ti',
    count: (items) => countGpuExact(items, 'gpu:gtx1080'),
  },
  {
    id: 'rtx-2080',
    label: 'RTX 2080',
    hint: 'non-Ti',
    count: (items) => countGpuExact(items, 'gpu:rtx2080'),
  },
  {
    id: 'rtx-3070',
    label: 'RTX 3070',
    hint: 'non-Ti',
    count: (items) => countGpuExact(items, 'gpu:rtx3070'),
  },
];

export function computeReinvestStockTargets(
  items: InventoryItem[],
  target = DEFAULT_STOCK_TARGET,
): StockTargetRow[] {
  return TARGETS.map((t) => {
    const current = t.count(items);
    return {
      id: t.id,
      label: t.label,
      hint: t.hint,
      current,
      target,
      need: Math.max(0, target - current),
    };
  });
}

export function computeReinvestStockGaps(
  items: InventoryItem[],
  target = DEFAULT_STOCK_TARGET,
): StockTargetRow[] {
  return computeReinvestStockTargets(items, target).filter((r) => r.need > 0);
}
