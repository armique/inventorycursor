/**
 * Verify per-category reinvest budgets: net cash flow (sold - bought) per component category
 * since a season baseline date, with bundle children categorized individually and lump-sum
 * PC/bundle sales falling into "other" rather than polluting a single component category.
 * Run: npx tsx scripts/verify-category-budgets.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import { computeCategoryBudgets, getSeasonStartDate } from '../utils/categoryBudgets';

function item(partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'name'>): InventoryItem {
  return {
    buyPrice: 0,
    sellPrice: 0,
    status: ItemStatus.IN_STOCK,
    category: 'Components',
    subCategory: 'Storage',
    buyDate: '2026-06-01',
    ...partial,
  } as InventoryItem;
}

const SINCE = '2026-06-01';

// The user's own example: bought an SSD for 15, sold it for 30 -> budget should read 30 - 15 = 15
// net, with the card showing the full 15/30 breakdown (not a made-up 30 "available" figure).
const ssd = item({
  id: 'ssd-1', name: 'Samsung 970 EVO 512GB SSD', status: ItemStatus.SOLD,
  buyPrice: 15, buyDate: '2026-06-05', sellPrice: 30, sellDate: '2026-06-10',
});
const b1 = computeCategoryBudgets([ssd], SINCE);
assert.equal(b1.length, 1);
assert.equal(b1[0].key, 'storage');
assert.equal(b1[0].bought, 15);
assert.equal(b1[0].sold, 30);
assert.equal(b1[0].budget, 15);
console.log('OK: SSD bought 15 / sold 30 -> storage budget = 15 (net), bought/sold both surfaced');

// Purchases before the season start don't count as a debit -- only the sale (after the cutoff)
// credits the category, matching "money already spent before this tracking window started".
const oldBuyNewSell = item({
  id: 'gpu-1', name: 'RTX 3070', status: ItemStatus.SOLD,
  buyPrice: 150, buyDate: '2026-01-01', sellPrice: 220, sellDate: '2026-06-15',
});
const b2 = computeCategoryBudgets([oldBuyNewSell], SINCE);
const gpu = b2.find((x) => x.key === 'gpu')!;
assert.equal(gpu.bought, 0);
assert.equal(gpu.sold, 220);
assert.equal(gpu.budget, 220);
console.log('OK: pre-season buy is excluded; only the in-window sale credits the category');

// Bundle children with real per-part prices categorize individually; the container itself,
// sold as one lump sum with no per-child sell price, falls into "other" not a component bucket.
const containerId = 'pc-1';
const cpuChild = item({
  id: 'cpu-1', name: 'Intel Core i5-7500', status: ItemStatus.SOLD, parentContainerId: containerId,
  buyPrice: 20, buyDate: '2026-06-02', sellPrice: 50, sellDate: '2026-06-20',
});
const ramChild = item({
  id: 'ram-1', name: '8GB DDR4 RAM', status: ItemStatus.SOLD, parentContainerId: containerId,
  buyPrice: 5, buyDate: '2026-06-02', sellPrice: 15, sellDate: '2026-06-20',
});
const container = item({
  id: containerId, name: 'Office PC', isPC: true, status: ItemStatus.SOLD,
  componentIds: [cpuChild.id, ramChild.id], buyPrice: 0, sellPrice: 0,
});
const b3 = computeCategoryBudgets([container, cpuChild, ramChild], SINCE);
const cpuBucket = b3.find((x) => x.key === 'cpu')!;
const ramBucket = b3.find((x) => x.key === 'ram')!;
assert.equal(cpuBucket.budget, 30);
assert.equal(ramBucket.budget, 10);
console.log('OK: proportional-priced PC children categorize individually (CPU +30, RAM +10)');

// A whole PC sold as one non-proportional lump sum (no per-child sell price) lands in "other".
const lumpContainerId = 'pc-2';
const lumpChild = item({
  id: 'gpu-2', name: 'GTX 1660', status: ItemStatus.IN_COMPOSITION, parentContainerId: lumpContainerId,
  buyPrice: 60, buyDate: '2026-06-03',
});
const lumpContainer = item({
  id: lumpContainerId, name: 'Gaming PC bundle', isPC: true, status: ItemStatus.SOLD,
  componentIds: [lumpChild.id], sellPrice: 200, sellDate: '2026-06-25',
});
const b4 = computeCategoryBudgets([lumpContainer, lumpChild], SINCE);
const other = b4.find((x) => x.key === 'other')!;
const gpuFromLump = b4.find((x) => x.key === 'gpu');
assert.equal(other.sold, 200);
assert.equal(gpuFromLump?.bought ?? 0, 60);
console.log('OK: lump-sum PC sale credits "other", while its GPU child\'s buy still debits gpu');

// Season start date: on/after Jun 1 -> this year; before Jun 1 -> last year.
assert.equal(getSeasonStartDate(new Date('2026-07-28')), '2026-06-01');
assert.equal(getSeasonStartDate(new Date('2026-03-15')), '2025-06-01');
console.log('OK: season start date resolves to Jun 1, rolling back a year before it arrives');

console.log('\nAll category budget checks passed.');
