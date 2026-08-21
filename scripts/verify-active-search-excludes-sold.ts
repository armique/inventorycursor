/**
 * Active search must not leak sold items (incl. IN_COMPOSITION parts under sold PCs).
 * Run: npx tsx scripts/verify-active-search-excludes-sold.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import { itemMatchesActiveInventoryTab } from '../services/financialAggregation';

function item(partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'name'>): InventoryItem {
  return {
    buyPrice: 0,
    status: ItemStatus.IN_STOCK,
    category: 'Components',
    buyDate: '2026-01-01',
    ...partial,
  } as InventoryItem;
}

const pcSold = item({
  id: 'pc-sold',
  name: 'PC · Sold Build with GTX 1080',
  isPC: true,
  status: ItemStatus.SOLD,
  sellDate: '2025-10-14',
  sellPrice: 280,
  componentIds: ['gpu-in-sold'],
});
const gpuInSold = item({
  id: 'gpu-in-sold',
  name: 'MSI GTX 1080 X 8G',
  status: ItemStatus.IN_COMPOSITION,
  parentContainerId: 'pc-sold',
  subCategory: 'GPU',
});
const gpuActive = item({
  id: 'gpu-active',
  name: 'GTX 1080 Without Box',
  status: ItemStatus.IN_STOCK,
  subCategory: 'GPU',
});
const pcActive = item({
  id: 'pc-active',
  name: 'PC · Active with 1080',
  isPC: true,
  status: ItemStatus.IN_STOCK,
  componentIds: ['gpu-in-active'],
});
const gpuInActive = item({
  id: 'gpu-in-active',
  name: 'ASUS GTX 1080',
  status: ItemStatus.IN_COMPOSITION,
  parentContainerId: 'pc-active',
  subCategory: 'GPU',
});

const items = [pcSold, gpuInSold, gpuActive, pcActive, gpuInActive];

assert.equal(itemMatchesActiveInventoryTab(gpuActive, items), true);
assert.equal(itemMatchesActiveInventoryTab(pcActive, items), true);
assert.equal(itemMatchesActiveInventoryTab(gpuInActive, items), true);
assert.equal(itemMatchesActiveInventoryTab(pcSold, items), false);
assert.equal(itemMatchesActiveInventoryTab(gpuInSold, items), false, 'sold-PC part must not match Active');

console.log('verify-active-search-excludes-sold: ok');
