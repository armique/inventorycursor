/**
 * Synthetic benchmark of the inventory search filter hot loop (Search Performance Sprint).
 * Replicates the per-keystroke work of filterAndSortInventoryItems' search path using the
 * real production helpers on a dataset shaped like the live one (~2000 items, ~160 containers).
 * Run: npx tsx scripts/bench-search-filter.ts
 */
import { performance } from 'node:perf_hooks';
import { ItemStatus, type InventoryItem } from '../types';
import {
  itemMatchesActiveInventoryTab,
  containerOrChildMatchesSearch,
  shouldSurfaceSoldContainerPartInList,
  buildInventoryLookup,
  type InventoryLookup,
} from '../services/financialAggregation';
import { buildInventorySearchMatcher } from '../utils/inventorySearchIndex';
import { isRealizedDisposal } from '../utils/itemDisposition';

/** Frozen pre-sprint haystack (no WeakMap) so the "legacy" bench is a true QW6 baseline. */
function refHaystack(item: InventoryItem): string {
  const specs = item.specs ? Object.entries(item.specs).map(([k, v]) => `${k}:${v}`).join(' ') : '';
  const url = (item.kleinanzeigenSellerProfileUrl || '').trim();
  const parts = [
    item.name,
    item.category,
    item.subCategory,
    item.comment1,
    item.comment2,
    item.vendor,
    item.ebaySku,
    item.ebayOrderId,
    item.invoiceNumber,
    item.customer?.name,
    item.customer?.email,
    specs,
  ];
  if (url) {
    parts.push(url);
    const m = url.match(/[?&]userId=(\d+)/i);
    if (m?.[1]) parts.push(m[1], `userid=${m[1]}`);
  }
  return parts.filter(Boolean).join(' ').toLowerCase();
}

function refMatchesInventorySearch(item: InventoryItem, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (query.length < 2) return true;
  const tokens = query
    .split(/[\s,;/?&=]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t !== 'https:' && t !== 'http:');
  if (tokens.length === 0) return true;
  const text = refHaystack(item);
  return tokens.every((t) => text.includes(t));
}

// Deterministic RNG so before/after runs use the identical dataset.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(1337);
const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];

const GPU_NAMES = ['MSI GTX 1080 Gaming X 8G', 'ASUS GTX 1070 Strix', 'EVGA RTX 2070 XC', 'Palit GTX 1660 Super', 'Gigabyte RX 580 8GB', 'Zotac GTX 1080 Ti Mini'];
const CPU_NAMES = ['Intel i7-4790K', 'Intel i5-9400F', 'AMD Ryzen 5 3600', 'Intel Xeon E3-1231v3'];
const MISC_NAMES = ['Be Quiet Pure Power 600W', 'Corsair Vengeance 16GB DDR4', 'Samsung 860 EVO 500GB', 'Fractal Design Meshify C'];

function makeItems(total = 1998, containers = 162): InventoryItem[] {
  const items: InventoryItem[] = [];
  let id = 0;
  const nextId = () => `it-${++id}`;

  for (let c = 0; c < containers; c++) {
    const pcId = nextId();
    const childCount = 2 + Math.floor(rnd() * 3);
    const childIds: string[] = [];
    for (let k = 0; k < childCount; k++) {
      const cid = nextId();
      childIds.push(cid);
      items.push({
        id: cid,
        name: `${pick([...GPU_NAMES, ...CPU_NAMES, ...MISC_NAMES])} #${cid}`,
        buyPrice: Math.round(rnd() * 300),
        status: ItemStatus.IN_COMPOSITION,
        category: 'Components',
        subCategory: pick(['GPU', 'CPU', 'RAM', 'PSU']),
        buyDate: '2026-01-10',
        // ~10% stale: parent linkage only via container componentIds (forces fallback scan).
        parentContainerId: rnd() < 0.9 ? pcId : undefined,
      } as InventoryItem);
    }
    const sold = rnd() < 0.45;
    items.push({
      id: pcId,
      name: `PC · Build ${pcId} ${pick(CPU_NAMES)} + ${pick(GPU_NAMES)}`,
      buyPrice: Math.round(rnd() * 500),
      status: sold ? ItemStatus.SOLD : ItemStatus.IN_STOCK,
      sellDate: sold ? '2026-03-05' : undefined,
      sellPrice: sold ? Math.round(300 + rnd() * 700) : undefined,
      isPC: true,
      category: 'PC',
      buyDate: '2026-01-05',
      componentIds: childIds,
    } as InventoryItem);
  }

  while (items.length < total) {
    const iid = nextId();
    const sold = rnd() < 0.4;
    items.push({
      id: iid,
      name: `${pick([...GPU_NAMES, ...CPU_NAMES, ...MISC_NAMES])} #${iid}`,
      buyPrice: Math.round(rnd() * 400),
      status: sold ? ItemStatus.SOLD : ItemStatus.IN_STOCK,
      sellDate: sold ? '2026-02-20' : undefined,
      sellPrice: sold ? Math.round(rnd() * 500) : undefined,
      category: 'Components',
      subCategory: pick(['GPU', 'CPU', 'RAM', 'PSU', 'SSD']),
      buyDate: '2026-01-15',
      vendor: pick(['kleinanzeigen', 'ebay', 'local']),
      comment1: rnd() < 0.3 ? 'tested, works fine, minor scratches' : undefined,
      specs: rnd() < 0.5 ? { VRAM: '8GB', Interface: 'PCIe 3.0' } : undefined,
      kleinanzeigenSellerProfileUrl:
        rnd() < 0.15 ? `https://www.kleinanzeigen.de/s-bestandsliste.html?userId=${Math.floor(rnd() * 1e8)}` : undefined,
    } as unknown as InventoryItem);
  }
  return items;
}

function buildHiddenChildIds(items: InventoryItem[]): Set<string> {
  const s = new Set<string>();
  for (const i of items) {
    if (i.parentContainerId) s.add(i.id);
    if ((i.isBundle || i.isPC) && i.componentIds?.length) {
      for (const cid of i.componentIds) s.add(cid);
    }
  }
  return s;
}

/** Mirrors the search-relevant branch structure of filterAndSortInventoryItems (ACTIVE tab). */
function passActive(items: InventoryItem[], hiddenChildIds: Set<string>, query: string): number {
  const q = query.trim();
  const searchActive = q.length >= 2;
  let count = 0;
  for (const item of items) {
    if (!itemMatchesActiveInventoryTab(item, items)) continue;
    const isHiddenChild = !item.isBundle && !item.isPC && hiddenChildIds.has(item.id);
    if (isHiddenChild) {
      if (!shouldSurfaceSoldContainerPartInList(item, items, 'ACTIVE', 'ALL', '')) continue;
    }
    if (searchActive) {
      if (item.isBundle || item.isPC) {
        if (!containerOrChildMatchesSearch(item, items, q, refMatchesInventorySearch)) continue;
      } else if (!refMatchesInventorySearch(item, q)) continue;
    }
    count++;
  }
  return count;
}

/** SOLD tab equivalent (status gate differs). */
function passSold(items: InventoryItem[], hiddenChildIds: Set<string>, query: string): number {
  const q = query.trim();
  const searchActive = q.length >= 2;
  let count = 0;
  for (const item of items) {
    let matchesStatus = isRealizedDisposal(item);
    if (!matchesStatus && shouldSurfaceSoldContainerPartInList(item, items, 'SOLD', 'ALL', '')) {
      matchesStatus = true;
    }
    if (!matchesStatus) continue;
    const isHiddenChild = !item.isBundle && !item.isPC && hiddenChildIds.has(item.id);
    if (isHiddenChild) {
      if (!shouldSurfaceSoldContainerPartInList(item, items, 'SOLD', 'ALL', '')) continue;
    }
    if (searchActive) {
      if (item.isBundle || item.isPC) {
        if (!containerOrChildMatchesSearch(item, items, q, refMatchesInventorySearch)) continue;
      } else if (!refMatchesInventorySearch(item, q)) continue;
    }
    count++;
  }
  return count;
}

/** Optimized path — mirrors the post-sprint filter (lookup maps + precompiled matcher). */
function passActiveFast(
  items: InventoryItem[],
  hiddenChildIds: Set<string>,
  lookup: InventoryLookup,
  query: string
): number {
  const q = query.trim();
  const searchActive = q.length >= 2;
  const matcher = searchActive ? buildInventorySearchMatcher(q) : null;
  const matchesFn = matcher ? (it: InventoryItem) => matcher(it) : null;
  let count = 0;
  for (const item of items) {
    if (!itemMatchesActiveInventoryTab(item, items, lookup)) continue;
    const isHiddenChild = !item.isBundle && !item.isPC && hiddenChildIds.has(item.id);
    if (isHiddenChild) {
      if (!shouldSurfaceSoldContainerPartInList(item, items, 'ACTIVE', 'ALL', '', lookup)) continue;
    }
    if (searchActive && matchesFn) {
      if (item.isBundle || item.isPC) {
        if (!containerOrChildMatchesSearch(item, items, q, matchesFn, lookup)) continue;
      } else if (!matchesFn(item)) continue;
    }
    count++;
  }
  return count;
}

function passSoldFast(
  items: InventoryItem[],
  hiddenChildIds: Set<string>,
  lookup: InventoryLookup,
  query: string
): number {
  const q = query.trim();
  const searchActive = q.length >= 2;
  const matcher = searchActive ? buildInventorySearchMatcher(q) : null;
  const matchesFn = matcher ? (it: InventoryItem) => matcher(it) : null;
  let count = 0;
  for (const item of items) {
    let matchesStatus = isRealizedDisposal(item);
    if (!matchesStatus && shouldSurfaceSoldContainerPartInList(item, items, 'SOLD', 'ALL', '', lookup)) {
      matchesStatus = true;
    }
    if (!matchesStatus) continue;
    const isHiddenChild = !item.isBundle && !item.isPC && hiddenChildIds.has(item.id);
    if (isHiddenChild) {
      if (!shouldSurfaceSoldContainerPartInList(item, items, 'SOLD', 'ALL', '', lookup)) continue;
    }
    if (searchActive && matchesFn) {
      if (item.isBundle || item.isPC) {
        if (!containerOrChildMatchesSearch(item, items, q, matchesFn, lookup)) continue;
      } else if (!matchesFn(item)) continue;
    }
    count++;
  }
  return count;
}

const items = makeItems();
const hiddenChildIds = buildHiddenChildIds(items);
const lookup = buildInventoryLookup(items);
const KEYSTROKES = ['g', 'gt', 'gtx', 'gtx ', 'gtx 1', 'gtx 10', 'gtx 108', 'gtx 1080'];
const ROUNDS = 3;

function run(label: string, fn: (q: string) => number) {
  const perKey: number[][] = KEYSTROKES.map(() => []);
  let lastCounts: number[] = [];
  for (let r = 0; r < ROUNDS; r++) {
    lastCounts = [];
    KEYSTROKES.forEach((q, i) => {
      const t0 = performance.now();
      const n = fn(q);
      perKey[i].push(performance.now() - t0);
      lastCounts.push(n);
    });
  }
  const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const medians = perKey.map(med);
  const total = medians.reduce((a, b) => a + b, 0);
  console.log(`${label}: total ${total.toFixed(1)}ms for ${KEYSTROKES.length} keystrokes`);
  KEYSTROKES.forEach((q, i) => {
    console.log(`  "${q}" -> ${medians[i].toFixed(2)}ms (matches: ${lastCounts[i]})`);
  });
  return { medians, total, counts: lastCounts };
}

console.log(`dataset: ${items.length} items, ${items.filter((i) => i.isPC || i.isBundle).length} containers`);
const legacyActive = run('ACTIVE tab (legacy: O(N²) lookups + rebuild haystack)', (q) =>
  passActive(items, hiddenChildIds, q)
);
const legacySold = run('SOLD tab (legacy: O(N²) lookups + rebuild haystack)', (q) =>
  passSold(items, hiddenChildIds, q)
);
const fastActive = run('ACTIVE tab (optimized: lookup + matcher + haystack cache)', (q) =>
  passActiveFast(items, hiddenChildIds, lookup, q)
);
const fastSold = run('SOLD tab (optimized: lookup + matcher + haystack cache)', (q) =>
  passSoldFast(items, hiddenChildIds, lookup, q)
);

if (JSON.stringify(legacyActive.counts) !== JSON.stringify(fastActive.counts)) {
  console.error('MISMATCH ACTIVE:', legacyActive.counts, fastActive.counts);
  process.exit(1);
}
if (JSON.stringify(legacySold.counts) !== JSON.stringify(fastSold.counts)) {
  console.error('MISMATCH SOLD:', legacySold.counts, fastSold.counts);
  process.exit(1);
}
console.log(
  `speedup (ACTIVE): ${(legacyActive.total / Math.max(fastActive.total, 0.001)).toFixed(1)}x (${legacyActive.total.toFixed(1)}ms -> ${fastActive.total.toFixed(1)}ms)`
);
console.log(
  `speedup (SOLD): ${(legacySold.total / Math.max(fastSold.total, 0.001)).toFixed(1)}x (${legacySold.total.toFixed(1)}ms -> ${fastSold.total.toFixed(1)}ms)`
);
