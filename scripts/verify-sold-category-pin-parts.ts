/**
 * SOLD + Components/GPU must list GPUs nested under sold PCs (they stay IN_COMPOSITION).
 * Run: npx tsx scripts/verify-sold-category-pin-parts.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import {
  shouldHideContainerChildInList,
  shouldSurfaceSoldContainerPartInList,
  matchesInventoryCategoryPin,
  soldContainerPartDispositionDate,
} from '../services/financialAggregation';

function item(partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'name'>): InventoryItem {
  return {
    buyPrice: 0,
    sellPrice: 0,
    status: ItemStatus.IN_STOCK,
    category: 'Components',
    subCategory: 'GPU',
    buyDate: '2026-01-01',
    ...partial,
  } as InventoryItem;
}

const pcId = 'pc-1';
const gpuId = 'gpu-1';
const cpuId = 'cpu-1';
const soloGpuId = 'solo-gpu';

const items: InventoryItem[] = [
  item({
    id: gpuId,
    name: 'RTX 5070',
    category: 'Components',
    subCategory: 'GPU',
    status: ItemStatus.IN_COMPOSITION,
    parentContainerId: pcId,
    buyPrice: 400,
    sellPrice: 500,
  }),
  item({
    id: cpuId,
    name: 'i7 14700k',
    category: 'Components',
    subCategory: 'CPU',
    status: ItemStatus.IN_COMPOSITION,
    parentContainerId: pcId,
    buyPrice: 130,
  }),
  item({
    id: pcId,
    name: 'Gaming PC',
    category: 'PCs',
    subCategory: 'Prebuilt',
    isPC: true,
    componentIds: [gpuId, cpuId],
    status: ItemStatus.SOLD,
    sellPrice: 1550,
    sellDate: '2026-02-15',
  }),
  item({
    id: soloGpuId,
    name: 'RTX 3060 standalone',
    category: 'Components',
    subCategory: 'GPU',
    status: ItemStatus.SOLD,
    sellPrice: 220,
    sellDate: '2026-03-01',
  }),
];

const gpu = items.find((i) => i.id === gpuId)!;
const cpu = items.find((i) => i.id === cpuId)!;
const solo = items.find((i) => i.id === soloGpuId)!;

assert.equal(shouldHideContainerChildInList(gpu, items), true, 'GPU nests under PC by default');
assert.equal(
  shouldSurfaceSoldContainerPartInList(gpu, items, 'SOLD', 'Components', 'GPU'),
  true,
  'SOLD + Components/GPU must surface nested GPU',
);
assert.equal(
  shouldSurfaceSoldContainerPartInList(cpu, items, 'SOLD', 'Components', 'GPU'),
  false,
  'CPU must not surface under GPU pin',
);
assert.equal(
  shouldSurfaceSoldContainerPartInList(gpu, items, 'SOLD', 'ALL', ''),
  false,
  'without category pin, keep nested',
);
assert.equal(
  shouldSurfaceSoldContainerPartInList(gpu, items, 'ACTIVE', 'Components', 'GPU'),
  false,
  'ACTIVE must not un-nest build parts',
);
assert.equal(matchesInventoryCategoryPin(solo, 'Components', 'GPU'), true);
assert.equal(soldContainerPartDispositionDate(gpu, items), '2026-02-15');

console.log('OK: SOLD category pin surfaces nested GPUs from sold PCs without un-nesting on ACTIVE');
console.log('\nAll sold category-pin part checks passed.');
