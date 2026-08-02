/**
 * Verify buy-anchored bundle-component price recalculation.
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
// Case A: no buy prices, no Dealwatch → category euro priors (GPU/CPU > RAM/case).
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
assert.ok(Math.abs(total - 1000) < 0.02, `allocations should sum back to the container's sell price, got ${total}`);

assert.ok(byId.get(gpuId)!.newSellPrice > byId.get(ramId)!.newSellPrice, 'GPU should get more than RAM');
assert.ok(byId.get(cpuId)!.newSellPrice > byId.get(caseId)!.newSellPrice, 'CPU should get more than the case');
assert.ok(byId.get(gpuId)!.newSellPrice > byId.get(cpuId)!.newSellPrice, 'GPU should get more than CPU (higher prior)');
assert.equal(byId.get(gpuId)!.weightSource, 'category');
console.log(
  `OK: no buy/Dealwatch -> category priors (GPU €${byId.get(gpuId)!.newSellPrice} > CPU €${byId.get(cpuId)!.newSellPrice} > RAM €${byId.get(ramId)!.newSellPrice} > Case €${byId.get(caseId)!.newSellPrice}), sums to container total`,
);

// ============================================================
// Case B: no buy prices; RAM has real standalone sales → Dealwatch raises RAM vs category prior.
// ============================================================
const dealwatchItems: InventoryItem[] = [
  ...bundleItems,
  item({ id: 'std-ram-1', name: 'Corsair 16GB DDR4', buyPrice: 30, sellPrice: 400, buyDate: '2026-01-01', sellDate: '2026-01-05' }),
  item({ id: 'std-ram-2', name: 'Corsair 16GB DDR4', buyPrice: 30, sellPrice: 420, buyDate: '2026-01-01', sellDate: '2026-01-10' }),
];
const withDealwatch = suggestBundleComponentPrices(dealwatchItems[4], dealwatchItems);
const ramWithDealwatch = withDealwatch.find((s) => s.itemId === ramId)!;
assert.equal(ramWithDealwatch.weightSource, 'dealwatch');
assert.ok(
  ramWithDealwatch.newSellPrice > byId.get(ramId)!.newSellPrice,
  'real Dealwatch data for RAM should raise its allocated share vs the generic prior',
);
console.log(
  `OK: RAM with real standalone sales gets a Dealwatch-based share (€${ramWithDealwatch.newSellPrice}), above category-only €${byId.get(ramId)!.newSellPrice}`,
);

// ============================================================
// Case C: container.sellPrice cleared — still redistribute from sum of child sells.
// ============================================================
const proportionalOnly: InventoryItem[] = [
  item({ id: gpuId, name: 'RTX 3070 8GB', category: 'Components', subCategory: 'GPU', status: ItemStatus.IN_COMPOSITION, parentContainerId: containerId, sellPrice: 500, buyPrice: 400 }),
  item({ id: cpuId, name: 'Ryzen 5 5600X', category: 'Components', subCategory: 'CPU', status: ItemStatus.IN_COMPOSITION, parentContainerId: containerId, sellPrice: 250, buyPrice: 200 }),
  item({ id: ramId, name: 'Corsair 16GB DDR4', category: 'Components', subCategory: 'RAM', status: ItemStatus.IN_COMPOSITION, parentContainerId: containerId, sellPrice: 150, buyPrice: 80 }),
  item({ id: caseId, name: 'Corsair 4000D Gehause', category: 'Components', subCategory: 'Case', status: ItemStatus.IN_COMPOSITION, parentContainerId: containerId, sellPrice: 100, buyPrice: 50 }),
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
assert.ok(Math.abs(sumFromChildren - 1000) < 0.02, `should redistribute €1000 from child sells, got ${sumFromChildren}`);
const cpuFromBuy = fromChildrenSum.find((s) => s.itemId === cpuId)!;
assert.ok(cpuFromBuy.newSellPrice > 150, `buy-anchored CPU share should stay substantial, got €${cpuFromBuy.newSellPrice}`);
console.log(`OK: container sell 0 → uses child sell sum (€1000); CPU buy-anchored at €${cpuFromBuy.newSellPrice}`);

// ============================================================
// Case D: real costs + hot GPU Dealwatch must NOT crush a 14700K to pennies.
// ============================================================
const hotGpuItems: InventoryItem[] = [
  item({
    id: gpuId,
    name: 'RTX 5070 Gigabyte',
    category: 'Components',
    subCategory: 'GPU',
    status: ItemStatus.IN_COMPOSITION,
    parentContainerId: containerId,
    buyPrice: 447.09,
    sellPrice: 447.09,
  }),
  item({
    id: cpuId,
    name: 'i7 14700k',
    category: 'Components',
    subCategory: 'CPU',
    status: ItemStatus.IN_COMPOSITION,
    parentContainerId: containerId,
    buyPrice: 131.6,
    sellPrice: 131.6,
  }),
  item({
    id: ramId,
    name: '32GB DDR5 Crucial 4800Mhz',
    category: 'Components',
    subCategory: 'RAM',
    status: ItemStatus.IN_COMPOSITION,
    parentContainerId: containerId,
    buyPrice: 200,
    sellPrice: 200,
  }),
  item({
    id: caseId,
    name: 'Mars Gaming MC Vision',
    category: 'Components',
    subCategory: 'Case',
    status: ItemStatus.IN_COMPOSITION,
    parentContainerId: containerId,
    buyPrice: 67.07,
    sellPrice: 67.07,
  }),
  item({
    id: containerId,
    name: 'Gaming PC',
    category: 'PCs',
    subCategory: 'Prebuilt',
    isPC: true,
    componentIds: [gpuId, cpuId, ramId, caseId],
    status: ItemStatus.SOLD,
    sellPrice: 1550,
    sellDate: '2026-02-01',
  }),
  // Hot GPU comps that used to steal almost the entire split under the old €-vs-prior mix.
  item({ id: 'std-gpu-1', name: 'RTX 5070 Gigabyte', buyPrice: 400, sellPrice: 780, buyDate: '2026-01-01', sellDate: '2026-01-05' }),
  item({ id: 'std-gpu-2', name: 'RTX 5070 Gigabyte', buyPrice: 400, sellPrice: 800, buyDate: '2026-01-01', sellDate: '2026-01-10' }),
];
const crushProof = suggestBundleComponentPrices(hotGpuItems[4], hotGpuItems);
const cpuCrush = crushProof.find((s) => s.itemId === cpuId)!;
const gpuCrush = crushProof.find((s) => s.itemId === gpuId)!;
const crushTotal = crushProof.reduce((s, x) => s + x.newSellPrice, 0);
assert.ok(Math.abs(crushTotal - 1550) < 0.02, `crush-proof total should be €1550, got ${crushTotal}`);
assert.ok(
  cpuCrush.newSellPrice >= 100,
  `14700K must stay realistic vs €131.60 buy — got €${cpuCrush.newSellPrice} (old bug: ~€6)`,
);
assert.ok(
  Math.abs(cpuCrush.newSellPrice - (131.6 / (447.09 + 131.6 + 200 + 67.07)) * 1550) < 1,
  `CPU should track buy-cost share closely, got €${cpuCrush.newSellPrice}`,
);
assert.ok(
  Math.abs(gpuCrush.newSellPrice - (447.09 / (447.09 + 131.6 + 200 + 67.07)) * 1550) < 1,
  `GPU Dealwatch must not inflate above buy-cost share (got €${gpuCrush.newSellPrice})`,
);
assert.equal(cpuCrush.weightSource, 'buy');
assert.equal(gpuCrush.weightSource, 'buy');
console.log(
  `OK: buy-anchored ignores hot GPU Dealwatch — CPU €${cpuCrush.newSellPrice}, GPU €${gpuCrush.newSellPrice} (no €6 CPU)`,
);

console.log('\nAll bundle price recalculation checks passed.');
