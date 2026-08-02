/**
 * Duplicate historical compose must not double-count one PC sale.
 * Run: npx tsx scripts/verify-retro-compose-orphan-shell.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import {
  getChildren,
  isOrphanSoldContainerShell,
  shouldSkipForAggregatedSaleLine,
} from '../services/financialAggregation';
import {
  applyRetroComposeToInventory,
  reclaimComponentsFromOtherContainers,
} from '../utils/retroComposeApply';
import { buildRetroContainerAndComponents } from '../utils/retroSoldCompose';

function part(id: string, name: string, buy: number, sell: number): InventoryItem {
  return {
    id,
    name,
    category: 'Components',
    subCategory: 'Processors',
    status: ItemStatus.SOLD,
    buyPrice: buy,
    sellPrice: sell,
    buyDate: '2023-01-01',
    sellDate: '2024-01-16',
    comment1: '',
    comment2: '',
  };
}

const cpu = part('cpu', 'Ryzen 7 7700', 200, 175);
const gpu = part('gpu', 'RTX 4070', 400, 175);
const mobo = part('mobo', 'ASUS B650', 150, 175);

const first = buildRetroContainerAndComponents({
  items: [cpu, gpu, mobo],
  allItems: [cpu, gpu, mobo],
  kind: 'pc',
  bundleName: 'Gaming PC: 7 7700 + Ventus RTX 4070',
  sellDate: '2024-01-16',
  useSmartDistribution: false,
});

let inventory = [first.bundle, ...first.updatedComponents];

// Simulate a second historical compose months later on the same parts (bug path).
const second = buildRetroContainerAndComponents({
  items: first.updatedComponents.map((c) => ({
    ...c,
    status: ItemStatus.SOLD,
    parentContainerId: undefined,
  })),
  allItems: inventory,
  kind: 'pc',
  bundleName: 'PC • ASUS B650 - Ryzen 7 7700 - RTX 4070',
  sellDate: '2024-01-16',
  useSmartDistribution: false,
});

// Naive merge (old bug): both shells keep componentIds → UI shows same parts twice.
const naive = [
  first.bundle,
  second.bundle,
  ...second.updatedComponents,
];
assert.equal(getChildren(first.bundle, naive).length, 0, 'ownership filter: old shell owns nothing');
assert.equal(getChildren(second.bundle, naive).length, 3, 'new shell owns the parts');
assert.equal(isOrphanSoldContainerShell(first.bundle, naive), true);
assert.equal(shouldSkipForAggregatedSaleLine(first.bundle, naive), true);
assert.equal(shouldSkipForAggregatedSaleLine(second.bundle, naive), false);

const counted = naive.filter(
  (i) =>
    (i.status === ItemStatus.SOLD || i.status === ItemStatus.IN_COMPOSITION) &&
    !shouldSkipForAggregatedSaleLine(i, naive)
);
const revenue = counted.reduce((s, i) => s + (Number(i.sellPrice) || 0), 0);
assert.equal(revenue, 525, `dashboard should count one sale total, got ${revenue}`);

// Proper apply: reclaim + delete emptied shell.
inventory = [first.bundle, ...first.updatedComponents];
const applied = applyRetroComposeToInventory(inventory, second.bundle, second.updatedComponents);
assert.ok(applied.deleteIds.includes(first.bundle.id));
assert.equal(applied.nextItems.some((i) => i.id === first.bundle.id), false);
assert.equal(applied.nextItems.filter((i) => i.isPC || i.isBundle).length, 1);

const { nextItems, deleteIds } = reclaimComponentsFromOtherContainers(
  naive,
  second.bundle.componentIds || [],
  second.bundle.id
);
assert.ok(deleteIds.includes(first.bundle.id));
assert.equal(
  (nextItems.find((i) => i.id === first.bundle.id)?.componentIds || []).length,
  0
);

console.log('verify-retro-compose-orphan-shell: ok');
