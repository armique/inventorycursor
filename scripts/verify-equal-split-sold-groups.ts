import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import { suggestEqualSplitSoldGroups } from '../utils/suggestEqualSplitSoldGroups';
import { buildRetroContainerAndComponents } from '../utils/retroSoldCompose';

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
  // Different price same day — alone, not a group
  sold('odd', 'Random SSD', 'Storage (SSD/HDD)', 20, 35, '2025-06-10'),
  // Already in a container — ignored
  {
    ...sold('child', 'Old child', 'Processors', 10, 50, '2025-06-10'),
    parentContainerId: 'existing-bundle',
  },
  // Another day group
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
assert.ok(june!.suggestedKind === 'pc' || june!.suggestedKind === 'bundle');

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
assert.equal(bundle.sellPrice, 200);
assert.equal(updatedComponents.length, 4);
assert.ok(updatedComponents.every((c) => c.status === ItemStatus.IN_COMPOSITION));

console.log('verify-equal-split-sold-groups: ok');
