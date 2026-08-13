/**
 * Verify Reinvest Assistant analysis engine: sub-variant grouping, loss-aware confidence,
 * anchor-bundle detection, and buy/sell pricing math.
 * Run: npx tsx scripts/verify-reinvest-analysis.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import { buildReinvestData, targetStockQty } from '../utils/reinvestAnalysis';
import { computeReinvestPricing, defaultMarginForGroup } from '../utils/reinvestPricing';
import { loadReinvestFees } from '../utils/reinvestFees';

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

const items: InventoryItem[] = [];

// --- Sub-variant grouping: 512GB vs 1TB SSD must be separate groups, not merged by category ---
const ssd512Dates = ['2026-01-05', '2026-02-05', '2026-03-05', '2026-04-05'];
const ssd512Sells = [50, 52, 58, 62]; // rising price -> trend 'up'
ssd512Dates.forEach((sellDate, i) => {
  items.push(
    item({
      id: `ssd512-${i}`,
      name: 'Samsung 970 EVO Plus SSD 512GB',
      buyPrice: 30,
      sellPrice: ssd512Sells[i],
      buyDate: '2026-01-01',
      sellDate,
      platformSold: i % 2 === 0 ? 'ebay.de' : 'kleinanzeigen.de',
      feeAmount: 0,
    }),
  );
});
['2026-01-10', '2026-02-10', '2026-03-10'].forEach((sellDate, i) => {
  items.push(
    item({
      id: `ssd1tb-${i}`,
      name: 'Samsung 970 EVO Plus SSD 1TB',
      buyPrice: 45,
      sellPrice: 85,
      buyDate: '2026-01-05',
      sellDate,
      platformSold: 'kleinanzeigen.de',
    }),
  );
});

// --- Loss-aware confidence: 2 losing GPU trades ---
items.push(
  item({
    id: 'gpu-loss-1',
    name: 'MSI RTX 3060',
    category: 'Components',
    subCategory: 'Graphics Cards',
    buyPrice: 200,
    sellPrice: 180,
    buyDate: '2026-01-01',
    sellDate: '2026-01-15',
    platformSold: 'ebay.de',
  }),
);
items.push(
  item({
    id: 'gpu-loss-2',
    name: 'MSI RTX 3060',
    category: 'Components',
    subCategory: 'Graphics Cards',
    buyPrice: 210,
    sellPrice: 190,
    buyDate: '2026-01-10',
    sellDate: '2026-01-25',
    platformSold: 'ebay.de',
  }),
);

// --- Anchor bundle: same CPU repeated across 3 PCs with different motherboards ---
const boardNames = ['ASUS Prime Z390-A', 'MSI H410M Pro', 'Gigabyte Z490 Aorus'];
boardNames.forEach((boardName, i) => {
  const cpuId = `bundle-cpu-${i}`;
  const boardId = `bundle-board-${i}`;
  const containerId = `bundle-pc-${i}`;
  items.push(
    item({
      id: cpuId,
      name: 'Intel Core i7-4790K',
      category: 'Components',
      subCategory: 'CPU',
      buyPrice: 60,
      status: ItemStatus.IN_COMPOSITION,
      parentContainerId: containerId,
    }),
  );
  items.push(
    item({
      id: boardId,
      name: boardName,
      category: 'Components',
      subCategory: 'Motherboard',
      buyPrice: 40,
      status: ItemStatus.IN_COMPOSITION,
      parentContainerId: containerId,
    }),
  );
  items.push(
    item({
      id: containerId,
      name: `Gaming PC #${i}`,
      category: 'PCs',
      subCategory: 'Prebuilt',
      isPC: true,
      componentIds: [cpuId, boardId],
      buyPrice: 0,
      sellPrice: 140 + i * 5,
      buyDate: '2026-01-01',
      sellDate: `2026-0${i + 2}-01`,
      platformSold: 'kleinanzeigen.de',
    }),
  );
});
// Spare unbundled CPU sitting in stock — should count toward the anchor's currentStock proxy.
items.push(
  item({
    id: 'spare-cpu',
    name: 'Intel Core i7-4790K',
    category: 'Components',
    subCategory: 'CPU',
    buyPrice: 55,
    status: ItemStatus.IN_STOCK,
  }),
);

// --- RAM: sold several times, currently 0 in stock -> should need restocking ---
['2026-01-01', '2026-01-20', '2026-02-05', '2026-02-20'].forEach((sellDate, i) => {
  items.push(
    item({
      id: `ram-${i}`,
      name: 'Kingston Fury DDR4 16GB',
      category: 'Components',
      subCategory: 'RAM',
      buyPrice: 20,
      sellPrice: 35,
      buyDate: '2025-12-01',
      sellDate,
      platformSold: 'kleinanzeigen.de',
    }),
  );
});

const data = buildReinvestData(items);

// 1) Sub-variant grouping stays split, not merged into one "Storage" bucket.
const ssd512 = data.variants.find((g) => g.key === 'storage:ssd-512gb');
const ssd1tb = data.variants.find((g) => g.key === 'storage:ssd-1tb');
assert.ok(ssd512, 'expected a distinct 512GB SSD group');
assert.ok(ssd1tb, 'expected a distinct 1TB SSD group');
assert.equal(ssd512!.soldCount, 4);
assert.equal(ssd1tb!.soldCount, 3);
assert.equal(ssd512!.avgBuyPrice, 30);
assert.equal(ssd512!.kind, 'variant');
assert.equal(ssd512!.trend, 'up');
assert.ok(ssd512!.sellEbayCount > 0 && ssd512!.sellKaCount > 0, 'expected both platforms represented');
console.log('OK: sub-variant grouping keeps 512GB and 1TB SSD separate');

// 2) Loss-aware confidence + warning.
const gpuGroup = data.variants.find((g) => g.label.includes('RTX 3060'));
assert.ok(gpuGroup, 'expected the lossy RTX 3060 group');
assert.equal(gpuGroup!.lossCount, 2);
assert.equal(gpuGroup!.confidence, 'low');
assert.ok(gpuGroup!.warning?.includes('2 of the last 2 sales'), 'expected a loss warning');
assert.equal(gpuGroup!.profitOnlyAvgProfit, null, 'no profitable trades -> null, not silently 0');
console.log('OK: loss-aware confidence downgrade + warning text');

// 3) Anchor bundle detection: same CPU, 3 different motherboards -> one bundle row, not split.
assert.equal(data.bundles.length, 1, 'expected exactly one anchor bundle pattern');
const bundle = data.bundles[0];
assert.equal(bundle.anchorComponentKey, 'cpu:i7-4790k');
assert.equal(bundle.siblingCategory, 'motherboard');
assert.equal(bundle.soldCount, 3);
assert.equal(bundle.avgBuyPrice, 100); // 60 (cpu) + 40 (board) per bundle
assert.ok(bundle.label.toLowerCase().includes('i7-4790k'));
assert.ok(bundle.label.toLowerCase().startsWith('motherboard'));
assert.equal(bundle.currentStock, 1, 'spare unbundled CPU should count toward the anchor stock proxy');
console.log('OK: anchor bundle found as one row, priced on the bundle as a whole');

// 4) RAM needs restocking (sold repeatedly, 0 in stock).
const ramGroup = data.variants.find((g) => g.key === 'ram:ddr4-16gb');
assert.ok(ramGroup);
assert.equal(ramGroup!.currentStock, 0);
assert.ok(ramGroup!.targetStock >= 1);
assert.ok(ramGroup!.currentStock < ramGroup!.targetStock, 'RAM should surface as a restock candidate');
console.log('OK: zero-stock proven seller flagged for restock');

// 5) targetStockQty bounds.
assert.equal(targetStockQty(1, 10, 30, 'low'), 1);
assert.ok(targetStockQty(20, 10, 60, 'high') <= 5);
console.log('OK: targetStockQty stays within [1,5] and low confidence pins to 1');

// 6) Pricing math: KA vs eBay differ because of eBay fees, and buy cap sits below both list prices.
const fees = { ...loadReinvestFees(), ebayFeePct: 12.5, ebayAdsPct: 12.5, vatOnProfitPct: 19 };
const margin = defaultMarginForGroup(ssd512!);
const pricing = computeReinvestPricing(ssd512!, fees, margin);
assert.ok(pricing.suggestedMaxBuy != null && pricing.suggestedMaxBuy > 0);
assert.ok(pricing.suggestedMaxBuy! < pricing.sellKa);
assert.ok(pricing.ka && pricing.ebay, 'expected both channel breakdowns to be present');
assert.ok(pricing.ka!.netProfit !== pricing.ebay!.netProfit, 'KA and eBay profit should differ once fees apply');
console.log(
  `OK: pricing — margin ${margin}%, buy<=${pricing.suggestedMaxBuy}, KA net ${pricing.ka!.netProfit}, eBay net ${pricing.ebay!.netProfit}`,
);

console.log('\nAll reinvest analysis checks passed.');
