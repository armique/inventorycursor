/**
 * Verify Reinvest Assistant Phase 2.4/2.5: adjacent-category mining from bundle co-occurrence,
 * seasonal-note gating (needs ~6mo history + a real same-month signal), and aging-listing detection.
 * Run: npx tsx scripts/verify-reinvest-adjacent.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import { buildReinvestData, totalHistorySpanDays } from '../utils/reinvestAnalysis';

function item(partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'name'>): InventoryItem {
  return {
    buyPrice: 0,
    sellPrice: 0,
    status: ItemStatus.SOLD,
    category: 'Components',
    subCategory: 'Storage',
    buyDate: '2025-01-01',
    ...partial,
  } as InventoryItem;
}

function isoInCurrentMonth(day: number): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), day).toISOString().slice(0, 10);
}

// ============================================================
// Case A: adjacent categories — PSUs ride along in bundles but were never sold standalone.
// ============================================================
const adjacentItems: InventoryItem[] = [];
[0, 1, 2].forEach((i) => {
  const psuId = `psu-${i}`;
  const gpuId = `gpu-${i}`;
  const containerId = `pc-${i}`;
  adjacentItems.push(
    item({
      id: psuId,
      name: 'Corsair 650W PSU',
      category: 'Components',
      subCategory: 'PSU',
      buyPrice: 25,
      status: ItemStatus.IN_COMPOSITION,
      parentContainerId: containerId,
    }),
  );
  adjacentItems.push(
    item({
      id: gpuId,
      name: `MSI RTX 3060 #${i}`,
      category: 'Components',
      subCategory: 'Graphics Cards',
      buyPrice: 150,
      status: ItemStatus.IN_COMPOSITION,
      parentContainerId: containerId,
    }),
  );
  adjacentItems.push(
    item({
      id: containerId,
      name: `Gaming PC #${i}`,
      category: 'PCs',
      subCategory: 'Prebuilt',
      isPC: true,
      componentIds: [psuId, gpuId],
      buyPrice: 0,
      sellPrice: 220,
      buyDate: '2025-01-01',
      sellDate: '2025-02-01',
      platformSold: 'kleinanzeigen.de',
    }),
  );
});
const adjacentData = buildReinvestData(adjacentItems);
assert.ok(adjacentData.adjacentCategories.includes('PSU'), 'expected PSU to surface as an adjacent category');
// GPU rode along in the same bundles and also has zero standalone sales in this fixture, so it
// correctly qualifies too — adjacency is about "never sold on its own", not PSU-specific.
assert.ok(adjacentData.adjacentCategories.includes('GPU'));
console.log('OK: PSU (and GPU) mined as adjacent categories from bundle co-occurrence (never sold standalone)');

// ============================================================
// Case B: seasonal note — needs 6mo+ total history AND a real same-month cluster.
// ============================================================
const seasonalItems: InventoryItem[] = [];
// Stretch total account history past 180 days with an old baseline sale far from the seasonal cluster.
seasonalItems.push(
  item({
    id: 'baseline-old',
    name: 'Kingston Fury DDR4 8GB',
    category: 'Components',
    subCategory: 'RAM',
    buyPrice: 10,
    sellPrice: 20,
    buyDate: '2025-01-01',
    sellDate: '2025-01-20',
    platformSold: 'kleinanzeigen.de',
  }),
);
// A cheaper baseline sale outside the current month, to give the group a lower overall average.
seasonalItems.push(
  item({
    id: 'baseline-2',
    name: 'Kingston Fury DDR4 8GB',
    category: 'Components',
    subCategory: 'RAM',
    buyPrice: 10,
    sellPrice: 18,
    buyDate: '2025-02-01',
    sellDate: '2025-02-15',
    platformSold: 'kleinanzeigen.de',
  }),
);
// Two clearly-higher sales in the CURRENT calendar month -> real, repeatable seasonal signal.
[5, 12].forEach((day, i) => {
  seasonalItems.push(
    item({
      id: `seasonal-${i}`,
      name: 'Kingston Fury DDR4 8GB',
      category: 'Components',
      subCategory: 'RAM',
      buyPrice: 10,
      sellPrice: 30, // ~58% above the ~19 baseline average
      buyDate: '2025-03-01',
      sellDate: isoInCurrentMonth(day),
      platformSold: 'kleinanzeigen.de',
    }),
  );
});

assert.ok(totalHistorySpanDays(seasonalItems) >= 180, 'test fixture should span >=180 days');
const seasonalData = buildReinvestData(seasonalItems);
assert.equal(seasonalData.seasonalityReady, true);
const ramGroup = seasonalData.variants.find((g) => g.key === 'ram:ddr4-8gb');
assert.ok(ramGroup, 'expected the DDR4 8GB group to exist');
assert.ok(ramGroup!.seasonalNote, 'expected a seasonal note once there is a real same-month signal');
console.log(`OK: seasonal note fires with enough history + signal — "${ramGroup!.seasonalNote}"`);

// Same same-month cluster, but the WHOLE account's history is under 6 months -> must stay
// silent even though the monthly signal itself is identical to case B above.
function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}
const shortHistoryItems: InventoryItem[] = [
  item({
    id: 'short-baseline',
    name: 'Kingston Fury DDR4 8GB',
    category: 'Components',
    subCategory: 'RAM',
    buyPrice: 10,
    sellPrice: 20,
    buyDate: daysAgoIso(50),
    sellDate: daysAgoIso(40),
    platformSold: 'kleinanzeigen.de',
  }),
  item({
    id: 'short-baseline-2',
    name: 'Kingston Fury DDR4 8GB',
    category: 'Components',
    subCategory: 'RAM',
    buyPrice: 10,
    sellPrice: 18,
    buyDate: daysAgoIso(45),
    sellDate: daysAgoIso(35),
    platformSold: 'kleinanzeigen.de',
  }),
  ...[5, 12].map((day, i) =>
    item({
      id: `short-seasonal-${i}`,
      name: 'Kingston Fury DDR4 8GB',
      category: 'Components',
      subCategory: 'RAM',
      buyPrice: 10,
      sellPrice: 30,
      buyDate: daysAgoIso(30),
      sellDate: isoInCurrentMonth(day),
      platformSold: 'kleinanzeigen.de',
    }),
  ),
];
assert.ok(totalHistorySpanDays(shortHistoryItems) < 180, 'test fixture should span under 180 days');
const shortData = buildReinvestData(shortHistoryItems);
assert.equal(shortData.seasonalityReady, false);
const ramGroupShort = shortData.variants.find((g) => g.key === 'ram:ddr4-8gb');
assert.equal(ramGroupShort?.seasonalNote, undefined, 'must not claim a seasonal pattern without enough history');
console.log('OK: seasonal note stays silent when account history is under ~6 months');

// ============================================================
// Case C: aging listings — in-stock item sitting well past its group's usual time-to-sell.
// ============================================================
const agingItems: InventoryItem[] = [];
// Establish a reliable avgDaysToSell (~10 days) for "storage:ssd-256gb" with medium+ confidence.
[10, 9, 11, 10].forEach((days, i) => {
  agingItems.push(
    item({
      id: `ssd256-sold-${i}`,
      name: 'Crucial MX500 SSD 256GB',
      buyPrice: 15,
      sellPrice: 25,
      buyDate: '2025-01-01',
      sellDate: new Date(new Date('2025-01-01').getTime() + days * 86400000).toISOString().slice(0, 10),
      platformSold: 'ebay.de',
    }),
  );
});
// This one has been sitting far longer than the ~10 day average -> should be flagged.
const staleBuyDate = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
agingItems.push(
  item({
    id: 'ssd256-stale',
    name: 'Crucial MX500 SSD 256GB',
    buyPrice: 15,
    status: ItemStatus.IN_STOCK,
    buyDate: staleBuyDate,
  }),
);
// This one was just bought -> should NOT be flagged.
const freshBuyDate = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
agingItems.push(
  item({
    id: 'ssd256-fresh',
    name: 'Crucial MX500 SSD 256GB',
    buyPrice: 15,
    status: ItemStatus.IN_STOCK,
    buyDate: freshBuyDate,
  }),
);
const agingData = buildReinvestData(agingItems);
assert.equal(agingData.agingListings.length, 1, 'expected exactly the stale item to be flagged');
assert.equal(agingData.agingListings[0].itemId, 'ssd256-stale');
assert.ok(agingData.agingListings[0].daysHeld > agingData.agingListings[0].avgDaysToSell);
console.log('OK: only the genuinely stale listing is flagged, the fresh one is left alone');

console.log('\nAll reinvest adjacent/seasonal/aging checks passed.');
