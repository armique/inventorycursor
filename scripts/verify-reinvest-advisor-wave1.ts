/**
 * Wave-1 Reinvest advisor checks: pocket profit, attributed budgets, suspicion Qs, today brief.
 * Run: npx tsx scripts/verify-reinvest-advisor-wave1.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import { buildReinvestData, pocketProfitForReinvest } from '../utils/reinvestAnalysis';
import { computeCategoryBudgetsDetailed } from '../utils/categoryBudgets';
import { detectReinvestSuspicions } from '../utils/reinvestSuspicion';
import { buildReinvestTodayBrief } from '../utils/reinvestTodayBrief';
import { loadReinvestFees } from '../utils/reinvestFees';
import { defaultGamificationState } from '../utils/gamification';

function item(partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'name'>): InventoryItem {
  return {
    buyPrice: 0,
    sellPrice: 0,
    status: ItemStatus.SOLD,
    category: 'Components',
    subCategory: 'Graphics Cards',
    buyDate: '2026-06-01',
    ...partial,
  } as InventoryItem;
}

// Pocket profit subtracts fees + shipping
const pocketItem = item({
  id: 'p1',
  name: 'RTX 3060',
  buyPrice: 100,
  sellPrice: 150,
  feeAmount: 20,
  sellerPaidShipping: true,
  sellerShippingAmount: 10,
});
assert.equal(pocketProfitForReinvest(pocketItem), 20);
console.log('OK: pocket profit = sell − ship − buy − fees');

const pcId = 'pc-adv';
const items: InventoryItem[] = [
  item({
    id: 'gpu-a',
    name: 'RTX 3070 8GB',
    status: ItemStatus.IN_COMPOSITION,
    parentContainerId: pcId,
    buyPrice: 400,
    buyDate: '2026-06-02',
    sellPrice: 520,
    sellDate: '2026-06-20',
  }),
  item({
    id: pcId,
    name: 'Gaming PC',
    isPC: true,
    status: ItemStatus.SOLD,
    componentIds: ['gpu-a'],
    sellPrice: 520,
    sellDate: '2026-06-20',
  }),
  item({
    id: 'gpu-solo',
    name: 'RTX 3060',
    buyPrice: 180,
    sellPrice: 220,
    feeAmount: 15,
    sellDate: '2026-06-10',
    platformSold: 'ebay.de',
  }),
  item({
    id: 'gpu-solo-2',
    name: 'RTX 3060',
    buyPrice: 175,
    sellPrice: 210,
    feeAmount: 12,
    sellDate: '2026-06-18',
    platformSold: 'kleinanzeigen.de',
  }),
  item({
    id: 'gpu-solo-3',
    name: 'RTX 3060',
    buyPrice: 170,
    sellPrice: 205,
    feeAmount: 10,
    sellDate: '2026-06-25',
    platformSold: 'kleinanzeigen.de',
  }),
  item({
    id: 'stock-old',
    name: 'Old cooler sitting',
    status: ItemStatus.IN_STOCK,
    category: 'Components',
    subCategory: 'Cooling',
    buyPrice: 40,
    buyDate: '2025-01-01',
  }),
];

const budgets = computeCategoryBudgetsDetailed(items, '2026-06-01');
const gpuBudget = budgets.budgets.find((b) => b.key === 'gpu')!;
assert.ok(gpuBudget.sold >= 520, 'attributed GPU sell should credit gpu');
assert.equal(budgets.unattributedPcSold, 0);
console.log('OK: attributed PC part sell credits GPU cash box');

const data = buildReinvestData(items);
const rtx3060 = data.variants.find((g) => g.label.includes('3060') || g.key.includes('3060'));
assert.ok(rtx3060, '3060 group exists');
assert.ok(rtx3060!.feesObserved, 'fees observed on 3060 sample');
assert.ok(rtx3060!.allInclAvgProfit < rtx3060!.grossAvgProfit, 'pocket avg < gross avg when fees present');
console.log('OK: reinvest ranking uses pocket profit when fees exist');

const suspicions = detectReinvestSuspicions({ items, data, budgets, answers: {} });
assert.ok(Array.isArray(suspicions));
console.log(`OK: suspicion detectors returned ${suspicions.length} question(s)`);

const brief = buildReinvestTodayBrief({
  restock: data.variants.filter((g) => g.verdict === 'restock'),
  skipped: data.variants.filter((g) => g.verdict === 'skip'),
  suspicions,
  items,
  fees: loadReinvestFees(),
  gamification: defaultGamificationState(),
});
assert.ok(brief.sell.length >= 1, 'aging stock should appear in sell-first');
assert.ok('buy' in brief && 'skip' in brief && 'clarify' in brief);
console.log('OK: today brief has buy/skip/sell/clarify');

console.log('\nAll reinvest advisor wave-1 checks passed.');
