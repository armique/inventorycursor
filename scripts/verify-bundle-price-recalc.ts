/**
 * Verify weighted bundle-component price recalculation: category priors (GPU/CPU > RAM/PSU) and
 * Dealwatch-data override when the account has its own standalone sales for a part.
 * Run: npx tsx scripts/verify-bundle-price-recalc.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import { suggestBundleComponentPrices } from '../utils/bundlePriceRecalc';

function item(partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'name'>): InventoryItem {
  return {
    buyPrice: 0,
    sellPrice: 0,
    status: ItemStatus.SOLD,
    category: 'Components',
    subCategory: 'Storage',
    buyDate: '2026-01-01',
    ...partial,
  } as InventoryItem;
}

// ============================================================
// Case A: no Dealwatch data for any part -> falls back to category priors (GPU/CPU > RAM/case).
// ============================================================
const containerId = 'pc-1';
const gpuId = 'gpu-1';
const cpuId = 'cpu-1';
const ramId = 'ram-1';
const caseId = 'case-1';

const bundleItems: InventoryItem[] = [
  item({ id: gpuId, name: 'RTX 3070 8GB', category: 'Components', subCategory: 'GPU', status: ItemStatus.IN_COMPOSITION, parentContainerId: containerId }),
  item({ id: cpuId, name: 'Ryzen 5 5600X', category: 'Components', subCategory: 'CPU', status: ItemStatus.IN_COMPOSITION, parentContainerId: containerId }),
  item({ id: ramId, name: 'Corsair 16GB DDR4', category: 'Components', subCategory: 'RAM', status: ItemStatus.IN_COMPOSITION, parentContainerId: containerId }),
  item({ id: caseId, name: 'Corsair 4000D Gehause', category: 'Components', subCategory: 'Case', status: ItemStatus.IN_COMPOSITION, parentContainerId: containerId }),
  item({
    id: containerId,
    name: 'Gaming PC',
    category: 'PCs',
    subCategory: 'Prebuilt',
    isPC: true,
    componentIds: [gpuId, cpuId, ramId, caseId],
    status: ItemStatus.SOLD,
    sellPrice: 1000,
    sellDate: '2026-02-01',
  }),
];

const suggestions = suggestBundleComponentPrices(bundleItems[bundleItems.length - 1], bundleItems);
const byId = new Map(suggestions.map((s) => [s.itemId, s]));

assert.equal(suggestions.length, 4);
const total = suggestions.reduce((s, x) => s + x.newSellPrice, 0);
assert.ok(Math.abs(total - 1000) < 1, `allocations should sum back to the container's sell price, got ${total}`);

assert.ok(byId.get(gpuId)!.newSellPrice > byId.get(ramId)!.newSellPrice, 'GPU should get more than RAM');
assert.ok(byId.get(cpuId)!.newSellPrice > byId.get(caseId)!.newSellPrice, 'CPU should get more than the case');
assert.ok(byId.get(gpuId)!.newSellPrice > byId.get(cpuId)!.newSellPrice, 'GPU should get more than CPU (higher base weight)');
assert.equal(byId.get(gpuId)!.weightSource, 'category');
console.log(
  `OK: no Dealwatch data -> category priors (GPU €${byId.get(gpuId)!.newSellPrice} > CPU €${byId.get(cpuId)!.newSellPrice} > RAM €${byId.get(ramId)!.newSellPrice} > Case €${byId.get(caseId)!.newSellPrice}), sums to container total`,
);

// ============================================================
// Case B: real standalone sales exist for the RAM variant -> Dealwatch data wins over category prior.
// ============================================================
const dealwatchItems: InventoryItem[] = [
  ...bundleItems,
  // Several standalone DDR4 16GB sales at a high real price -> should outrank the generic RAM prior.
  item({ id: 'std-ram-1', name: 'Corsair 16GB DDR4', buyPrice: 30, sellPrice: 400, buyDate: '2026-01-01', sellDate: '2026-01-05' }),
  item({ id: 'std-ram-2', name: 'Corsair 16GB DDR4', buyPrice: 30, sellPrice: 420, buyDate: '2026-01-01', sellDate: '2026-01-10' }),
];
const withDealwatch = suggestBundleComponentPrices(dealwatchItems[4], dealwatchItems);
const ramWithDealwatch = withDealwatch.find((s) => s.itemId === ramId)!;
assert.equal(ramWithDealwatch.weightSource, 'dealwatch');
assert.ok(ramWithDealwatch.newSellPrice > byId.get(ramId)!.newSellPrice, 'real Dealwatch data for RAM should raise its allocated share vs the generic prior');
console.log(`OK: RAM with real standalone sales (avg €410) gets a Dealwatch-based share (€${ramWithDealwatch.newSellPrice}), overriding the generic low prior`);

// ============================================================
// Case C: container.sellPrice cleared — still redistribute from sum of child sells.
// ============================================================
const proportionalOnly: InventoryItem[] = [
  item({ id: gpuId, name: 'RTX 3070 8GB', category: 'Components', subCategory: 'GPU', status: ItemStatus.IN_COMPOSITION, parentContainerId: containerId, sellPrice: 500 }),
  item({ id: cpuId, name: 'Ryzen 5 5600X', category: 'Components', subCategory: 'CPU', status: ItemStatus.IN_COMPOSITION, parentContainerId: containerId, sellPrice: 250 }),
  item({ id: ramId, name: 'Corsair 16GB DDR4', category: 'Components', subCategory: 'RAM', status: ItemStatus.IN_COMPOSITION, parentContainerId: containerId, sellPrice: 150 }),
  item({ id: caseId, name: 'Corsair 4000D Gehause', category: 'Components', subCategory: 'Case', status: ItemStatus.IN_COMPOSITION, parentContainerId: containerId, sellPrice: 100 }),
  item({
    id: containerId,
    name: 'Gaming PC',
    category: 'PCs',
    subCategory: 'Prebuilt',
    isPC: true,
    componentIds: [gpuId, cpuId, ramId, caseId],
    status: ItemStatus.SOLD,
    sellPrice: 0,
    sellDate: '2026-02-01',
  }),
];
const fromChildrenSum = suggestBundleComponentPrices(proportionalOnly[4], proportionalOnly);
assert.equal(fromChildrenSum.length, 4);
const sumFromChildren = fromChildrenSum.reduce((s, x) => s + x.newSellPrice, 0);
assert.ok(Math.abs(sumFromChildren - 1000) < 1, `should redistribute €1000 from child sells, got ${sumFromChildren}`);
console.log(`OK: container sell 0 → uses child sell sum (€1000) for recalculation`);

console.log('\nAll bundle price recalculation checks passed.');
