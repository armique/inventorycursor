/**
 * Verify container buy-price resplit after adding a part to an existing bundle.
 * Run: npx tsx scripts/verify-container-buy-resplit.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import { resplitContainerBuyPrices } from '../utils/containerBuyPriceRecalc';

function item(partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'name'>): InventoryItem {
  return {
    buyPrice: 0,
    sellPrice: 0,
    status: ItemStatus.IN_COMPOSITION,
    category: 'Components',
    subCategory: 'Storage (SSD/HDD)',
    buyDate: '2026-01-01',
    ...partial,
  } as InventoryItem;
}

const containerId = 'bundle-1';
const a = item({
  id: 'ssd-a',
  name: 'SSD 512',
  subCategory: 'Storage (SSD/HDD)',
  buyPrice: 50,
  parentContainerId: containerId,
});
const b = item({
  id: 'ram-b',
  name: 'DDR4 16GB',
  subCategory: 'RAM',
  buyPrice: 50,
  parentContainerId: containerId,
});
const container = item({
  id: containerId,
  name: 'PC Bundle',
  category: 'Bundle',
  isBundle: true,
  status: ItemStatus.IN_STOCK,
  buyPrice: 100,
  componentIds: [a.id, b.id],
});

// Forgotten GPU added at €0 — resplit prior €100 lot across 3 parts.
const gpu = item({
  id: 'gpu-c',
  name: 'RTX 3070',
  subCategory: 'Graphics Cards',
  buyPrice: 0,
  status: ItemStatus.IN_COMPOSITION,
  parentContainerId: containerId,
});
const afterAdd = {
  ...container,
  componentIds: [a.id, b.id, gpu.id],
};

const { parent, children, totalCost } = resplitContainerBuyPrices({
  container: afterAdd,
  items: [afterAdd, a, b, gpu],
  totalCost: 100,
  mode: 'SMART',
});

assert.equal(children.length, 3);
assert.ok(Math.abs(totalCost - 100) < 0.02, `lot should stay €100, got ${totalCost}`);
assert.ok(Math.abs(Number(parent.buyPrice) - 100) < 0.02, `parent buy should be €100, got ${parent.buyPrice}`);

const byId = new Map(children.map((c) => [c.id, c]));
const gpuShare = Number(byId.get(gpu.id)!.buyPrice);
const ssdShare = Number(byId.get(a.id)!.buyPrice);
const ramShare = Number(byId.get(b.id)!.buyPrice);
assert.ok(gpuShare > 0, 'new GPU must receive a proportional buy price');
assert.ok(gpuShare > ssdShare, 'GPU should get more than SSD under SMART weights');
assert.ok(gpuShare > ramShare, 'GPU should get more than RAM under SMART weights');
assert.ok(
  Math.abs(gpuShare + ssdShare + ramShare - 100) < 0.02,
  `shares must sum to lot total, got ${gpuShare + ssdShare + ramShare}`
);

console.log(
  `OK: resplit €100 → GPU €${gpuShare} / SSD €${ssdShare} / RAM €${ramShare} (parent €${parent.buyPrice})`
);
console.log('\nAll container buy-resplit checks passed.');
