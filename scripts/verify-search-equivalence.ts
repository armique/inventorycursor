/**
 * Search Performance Sprint safety net: verifies that the optimized search/filter helpers
 * return byte-identical results to frozen copies of the pre-sprint implementations.
 * The `ref*` functions below are verbatim snapshots taken before QW1/QW2/QW6/QW7 landed.
 * Run: npx tsx scripts/verify-search-equivalence.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import {
  getChildren,
  getParentContainer,
  shouldHideContainerChildInList,
  isPartOfRealizedContainer,
  itemMatchesActiveInventoryTab,
  shouldSurfaceSoldContainerPartInList,
  containerOrChildMatchesSearch,
  matchesInventoryCategoryPin,
} from '../services/financialAggregation';
import {
  matchesInventorySearch,
  buildInventorySearchMatcher,
  extractKleinanzeigenUserId,
} from '../utils/inventorySearchIndex';
import { isRealizedDisposal } from '../utils/itemDisposition';

/* ------------------------------------------------------------------ */
/* Frozen reference implementations (pre-sprint, verbatim)            */
/* ------------------------------------------------------------------ */

function refTokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[\s,;/?&=]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t !== 'https:' && t !== 'http:');
}

function refProfileHaystackParts(item: InventoryItem): string[] {
  const url = (item.kleinanzeigenSellerProfileUrl || '').trim();
  if (!url) return [];
  const parts = [url];
  const userId = extractKleinanzeigenUserId(url);
  if (userId) {
    parts.push(userId, `userid=${userId}`);
  }
  return parts;
}

function refHaystack(item: InventoryItem): string {
  const specs = item.specs ? Object.entries(item.specs).map(([k, v]) => `${k}:${v}`).join(' ') : '';
  return [
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
    ...refProfileHaystackParts(item),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function refMatchesInventorySearch(item: InventoryItem, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (query.length < 2) return true;
  const tokens = refTokenize(query);
  if (tokens.length === 0) return true;
  const text = refHaystack(item);
  return tokens.every((t) => text.includes(t));
}

function refGetChildren(container: InventoryItem, items: InventoryItem[]): InventoryItem[] {
  const byIds = (container.componentIds || [])
    .map((id) => items.find((i) => i.id === id))
    .filter((x): x is InventoryItem => !!x)
    .filter((c) => !c.parentContainerId || c.parentContainerId === container.id);
  if (byIds.length > 0) return byIds;
  return items.filter((i) => i.parentContainerId === container.id);
}

function refGetParentContainer(item: InventoryItem, items: InventoryItem[]): InventoryItem | undefined {
  if (item.parentContainerId) {
    const direct = items.find((i) => i.id === item.parentContainerId);
    if (direct) return direct;
  }
  return items.find(
    (p) =>
      (p.isBundle || p.isPC) &&
      (p.componentIds || []).includes(item.id)
  );
}

function refShouldHideContainerChildInList(item: InventoryItem, items: InventoryItem[]): boolean {
  if (item.isBundle || item.isPC) return false;
  const parent = refGetParentContainer(item, items);
  if (!parent || (!parent.isBundle && !parent.isPC)) return false;
  return true;
}

function refIsPartOfRealizedContainer(item: InventoryItem, items: InventoryItem[]): boolean {
  if (item.isBundle || item.isPC) return false;
  const parent = refGetParentContainer(item, items);
  return Boolean(parent && (parent.isPC || parent.isBundle) && isRealizedDisposal(parent));
}

function refItemMatchesActiveInventoryTab(item: InventoryItem, items: InventoryItem[]): boolean {
  if (item.status === ItemStatus.IN_STOCK || item.status === ItemStatus.ORDERED) return true;
  if (item.status !== ItemStatus.IN_COMPOSITION) return false;
  return !refIsPartOfRealizedContainer(item, items);
}

function refShouldSurfaceSoldContainerPartInList(
  item: InventoryItem,
  items: InventoryItem[],
  statusFilter: string,
  categoryFilter: string,
  subCategoryFilter: string
): boolean {
  if (statusFilter !== 'SOLD') return false;
  if (categoryFilter === 'ALL' && !subCategoryFilter) return false;
  if (!matchesInventoryCategoryPin(item, categoryFilter, subCategoryFilter)) return false;
  return refIsPartOfRealizedContainer(item, items);
}

function refContainerOrChildMatchesSearch(
  item: InventoryItem,
  items: InventoryItem[],
  query: string,
  matchesFn: (item: InventoryItem, query: string) => boolean
): boolean {
  if (matchesFn(item, query)) return true;
  if (!item.isBundle && !item.isPC) return false;
  return refGetChildren(item, items).some((c) => matchesFn(c, query));
}

/* ------------------------------------------------------------------ */
/* Randomized dataset (seeded, includes stale-linkage edge cases)     */
/* ------------------------------------------------------------------ */

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(42);
const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];

const NAMES = [
  'MSI GTX 1080 Gaming X 8G',
  'Intel i7-4790K',
  'AMD Ryzen 5 3600',
  'Corsair Vengeance 16GB',
  'PC · Office Build i5',
  'Bundle GPU + PSU',
  'Samsung 860 EVO 500GB',
];
const STATUSES = [
  ItemStatus.IN_STOCK,
  ItemStatus.SOLD,
  ItemStatus.ORDERED,
  ItemStatus.IN_COMPOSITION,
  ItemStatus.TRADED,
];

function makeDataset(n: number): InventoryItem[] {
  const items: InventoryItem[] = [];
  let id = 0;
  for (let c = 0; c < Math.floor(n / 8); c++) {
    const pcId = `pc-${++id}`;
    const kids: string[] = [];
    const kidCount = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < kidCount; k++) {
      const cid = `ch-${++id}`;
      kids.push(cid);
      items.push({
        id: cid,
        name: `${pick(NAMES)} ${cid}`,
        buyPrice: 10,
        status: rnd() < 0.8 ? ItemStatus.IN_COMPOSITION : pick(STATUSES),
        category: 'Components',
        subCategory: pick(['GPU', 'CPU', 'RAM', '']),
        buyDate: '2026-01-01',
        // Edge cases: missing parent link, stale link to another container.
        parentContainerId: rnd() < 0.7 ? pcId : rnd() < 0.5 ? undefined : `pc-other-${Math.floor(rnd() * 5)}`,
      } as InventoryItem);
    }
    const sold = rnd() < 0.5;
    items.push({
      id: pcId,
      name: `PC Build ${pcId} with GTX 1080`,
      buyPrice: 100,
      status: sold ? pick([ItemStatus.SOLD, ItemStatus.TRADED]) : ItemStatus.IN_STOCK,
      sellDate: sold ? '2026-02-01' : undefined,
      isPC: rnd() < 0.7,
      isBundle: rnd() < 0.4,
      category: 'PC',
      buyDate: '2026-01-01',
      // Edge case: some containers list ids that don't exist or belong elsewhere.
      componentIds: rnd() < 0.9 ? kids : [...kids, 'ghost-id', items[0]?.id].filter(Boolean) as string[],
    } as InventoryItem);
  }
  while (items.length < n) {
    const iid = `solo-${++id}`;
    items.push({
      id: iid,
      name: `${pick(NAMES)} ${iid}`,
      buyPrice: 20,
      status: pick(STATUSES),
      category: pick(['Components', 'Processors', 'PC']),
      subCategory: pick(['GPU', 'CPU', '']),
      buyDate: '2026-01-02',
      sellDate: rnd() < 0.3 ? '2026-03-01' : undefined,
      comment1: rnd() < 0.3 ? 'works fine ohne OVP' : undefined,
      specs: rnd() < 0.4 ? { VRAM: '8GB', Sockel: 'LGA1150' } : undefined,
      kleinanzeigenSellerProfileUrl:
        rnd() < 0.2 ? `https://www.kleinanzeigen.de/s-bestandsliste.html?userId=${Math.floor(rnd() * 1e8)}` : undefined,
    } as unknown as InventoryItem);
  }
  return items;
}

const QUERIES = [
  '',
  'g',
  'gt',
  'gtx',
  'gtx 1080',
  'GTX 1080',
  'i7-4790k',
  '8gb vram',
  'ohne ovp',
  'https://www.kleinanzeigen.de/s-bestandsliste.html?userId=12345678',
  'userId=12345678',
  'pc build',
  'sockel lga1150',
  '  gtx   1080  ',
];

/* ------------------------------------------------------------------ */
/* Equivalence checks                                                  */
/* ------------------------------------------------------------------ */

type Lookup = ReturnType<typeof buildLookup>;
function buildLookup(items: InventoryItem[]) {
  const itemById = new Map<string, InventoryItem>();
  const childrenByParentId = new Map<string, InventoryItem[]>();
  const containerByComponentId = new Map<string, InventoryItem>();
  for (const i of items) {
    itemById.set(i.id, i);
    if (i.parentContainerId) {
      const arr = childrenByParentId.get(i.parentContainerId);
      if (arr) arr.push(i);
      else childrenByParentId.set(i.parentContainerId, [i]);
    }
  }
  for (const i of items) {
    if ((i.isBundle || i.isPC) && i.componentIds?.length) {
      for (const cid of i.componentIds) {
        if (!containerByComponentId.has(cid)) containerByComponentId.set(cid, i);
      }
    }
  }
  return { itemById, childrenByParentId, containerByComponentId };
}

function run() {
  const items = makeDataset(800);
  const lookup: Lookup = buildLookup(items);
  // The live helpers accept an optional lookup arg after QW7; passing extra args
  // before that lands is harmless at runtime and ignored by the old signatures.
  const liveVariants: Array<[string, Lookup | undefined]> = [
    ['no-lookup', undefined],
    ['with-lookup', lookup],
  ];

  let checks = 0;

  for (const item of items) {
    for (const q of QUERIES) {
      assert.equal(
        matchesInventorySearch(item, q),
        refMatchesInventorySearch(item, q),
        `matchesInventorySearch mismatch: item=${item.id} q="${q}"`
      );
      checks++;
    }
  }

  // QW6: the precompiled per-pass matcher must agree with the reference for every item.
  for (const q of QUERIES) {
    const matcher = buildInventorySearchMatcher(q);
    for (const item of items) {
      assert.equal(
        matcher(item),
        refMatchesInventorySearch(item, q),
        `buildInventorySearchMatcher mismatch: item=${item.id} q="${q}"`
      );
      checks++;
    }
  }

  for (const [label, lk] of liveVariants) {
    for (const item of items) {
      assert.deepEqual(
        (getChildren as any)(item, items, lk).map((c: InventoryItem) => c.id),
        refGetChildren(item, items).map((c) => c.id),
        `getChildren mismatch (${label}): ${item.id}`
      );
      assert.equal(
        ((getParentContainer as any)(item, items, lk) as InventoryItem | undefined)?.id,
        refGetParentContainer(item, items)?.id,
        `getParentContainer mismatch (${label}): ${item.id}`
      );
      assert.equal(
        (shouldHideContainerChildInList as any)(item, items, undefined, lk),
        refShouldHideContainerChildInList(item, items),
        `shouldHideContainerChildInList mismatch (${label}): ${item.id}`
      );
      assert.equal(
        (isPartOfRealizedContainer as any)(item, items, lk),
        refIsPartOfRealizedContainer(item, items),
        `isPartOfRealizedContainer mismatch (${label}): ${item.id}`
      );
      assert.equal(
        (itemMatchesActiveInventoryTab as any)(item, items, lk),
        refItemMatchesActiveInventoryTab(item, items),
        `itemMatchesActiveInventoryTab mismatch (${label}): ${item.id}`
      );
      checks += 5;

      for (const [cat, sub] of [
        ['ALL', ''],
        ['Components', 'GPU'],
        ['Components', ''],
        ['ALL', 'CPU'],
      ] as const) {
        for (const status of ['SOLD', 'ACTIVE'] as const) {
          assert.equal(
            (shouldSurfaceSoldContainerPartInList as any)(item, items, status, cat, sub, lk),
            refShouldSurfaceSoldContainerPartInList(item, items, status, cat, sub),
            `shouldSurfaceSoldContainerPartInList mismatch (${label}): ${item.id} ${status} ${cat}/${sub}`
          );
          checks++;
        }
      }

      for (const q of ['gtx 1080', 'i7-4790k', 'zzz-no-match', 'pc build']) {
        assert.equal(
          (containerOrChildMatchesSearch as any)(item, items, q, matchesInventorySearch, lk),
          refContainerOrChildMatchesSearch(item, items, q, refMatchesInventorySearch),
          `containerOrChildMatchesSearch mismatch (${label}): ${item.id} q="${q}"`
        );
        checks++;
      }
    }
  }

  console.log(`verify-search-equivalence: ok (${checks} checks, ${items.length} items)`);
}

run();
