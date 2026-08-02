import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';

// Minimal localStorage for ignore persistence in Node.
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => {
    mem.set(k, String(v));
  },
  removeItem: (k: string) => {
    mem.delete(k);
  },
};

const {
  suggestEqualSplitSoldGroups,
  ignoreEqualSplitGroupId,
  countEqualSplitSoldGroupCandidates,
} = await import('../utils/suggestEqualSplitSoldGroups');
const { buildRetroContainerAndComponents } = await import('../utils/retroSoldCompose');

function sold(
  id: string,
  name: string,
  subCategory: string,
  buyPrice: number,
  sellPrice: number,
  sellDate: string
): InventoryItem {
  return {
    id,
    name,
    category: 'Components',
    subCategory,
    status: ItemStatus.SOLD,
    buyPrice,
    sellPrice,
    buyDate: '2025-01-01',
    sellDate,
    comment1: '',
    comment2: '',
  };
}

const items: InventoryItem[] = [
  sold('cpu', 'AMD Ryzen 5 5600', 'Processors', 100, 50, '2025-06-10'),
  sold('mobo', 'MSI B450 Tomahawk', 'Motherboards', 80, 50, '2025-06-10'),
  sold('ram', 'DDR4 16GB (2x8GB)', 'RAM', 40, 50, '2025-06-10'),
  sold('gpu', 'RTX 3060', 'Graphics Cards', 200, 50, '2025-06-10'),
  sold('odd', 'Random SSD', 'Storage (SSD/HDD)', 20, 35, '2025-06-10'),
  {
    ...sold('child', 'Old child', 'Processors', 10, 50, '2025-06-10'),
    parentContainerId: 'existing-bundle',
  },
  sold('a', 'i7-4790K', 'Processors', 30, 25, '2025-03-01'),
  sold('b', 'ASRock H81M', 'Motherboards', 20, 25, '2025-03-01'),
];

const groups = suggestEqualSplitSoldGroups(items);
assert.equal(groups.length, 2, `expected 2 groups, got ${groups.length}`);

const june = groups.find((g) => g.sellDate === '2025-06-10');
assert.ok(june);
assert.equal(june!.itemIds.length, 4);
assert.equal(june!.equalSellPrice, 50);
assert.equal(june!.totalSell, 200);

const parts = june!.itemIds.map((id) => items.find((i) => i.id === id)!);
const { bundle, updatedComponents } = buildRetroContainerAndComponents({
  items: parts,
  allItems: items,
  kind: 'pc',
  bundleName: 'PC · test',
  sellDate: june!.sellDate,
  useSmartDistribution: true,
});
assert.equal(bundle.isPC, true);
assert.equal(bundle.isBundle, false);
assert.equal(bundle.sellPrice, 200);
assert.equal(updatedComponents.length, 4);
assert.ok(updatedComponents.every((c) => c.status === ItemStatus.IN_COMPOSITION));

// After compose, the same equal-split bucket must disappear (parts claimed by the PC).
const afterCompose = [...items.filter((i) => !june!.itemIds.includes(i.id)), bundle, ...updatedComponents];
assert.equal(
  suggestEqualSplitSoldGroups(afterCompose).some((g) => g.sellDate === '2025-06-10' && g.equalSellPrice === 50),
  false,
  'already-composed equal-split group must not be suggested again'
);

// Stale componentIds alone must NOT hide sold equal-split candidates (button disappeared).
const leakedSold = updatedComponents.map((c) => ({
  ...c,
  status: ItemStatus.SOLD,
  parentContainerId: undefined,
  sellPrice: 50, // still look like equal-split rows
  sellDate: '2025-06-10',
}));
const leakInventory = [
  { ...bundle, componentIds: leakedSold.map((c) => c.id) },
  ...leakedSold,
  ...items.filter((i) => !june!.itemIds.includes(i.id)),
];
assert.equal(
  suggestEqualSplitSoldGroups(leakInventory).some((g) => g.itemIds.includes('cpu')),
  true,
  'sold parts without parentContainerId stay suggestable even if listed on a stale shell'
);

// Once really owned (parentContainerId), they disappear from suggestions.
const ownedLeak = leakedSold.map((c) => ({ ...c, parentContainerId: bundle.id, status: ItemStatus.IN_COMPOSITION }));
const ownedInventory = [{ ...bundle, componentIds: ownedLeak.map((c) => c.id) }, ...ownedLeak];
assert.equal(
  suggestEqualSplitSoldGroups(ownedInventory).some((g) => g.itemIds.includes('cpu')),
  false,
  'parts with real parentContainerId must not re-enter suggestions'
);

ignoreEqualSplitGroupId(june!.id);
assert.equal(countEqualSplitSoldGroupCandidates(items), 1);
assert.equal(suggestEqualSplitSoldGroups(items).length, 1);
assert.equal(suggestEqualSplitSoldGroups(items, { includeIgnored: true }).length, 2);

console.log('verify-equal-split-sold-groups: ok');
