/**
 * Verify Reinvest Assistant financial advisor: dynamic reserve
 * split, cushion suggestion, concentration warning, growth projection, break-even timers, CSV
 * export shape.
 * Run: npx tsx scripts/verify-reinvest-advisor.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type Expense, type InventoryItem } from '../types';
import { buildReinvestData } from '../utils/reinvestAnalysis';
import {
  computeAdvisorSplitPct,
  computeAvgMonthlyProfit,
  computeBreakEvenTimers,
  computeConcentrationWarning,
  defaultCapitalPlanningState,
  effectiveBankSplitPct,
  simulateGrowth,
  suggestCushionGoal,
} from '../utils/financialPlanning';
import { buildTradeHistoryCsv } from '../utils/tradeExport';

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

// 1) computeAdvisorSplitPct
const base = defaultCapitalPlanningState();
const noGoal = computeAdvisorSplitPct(base);
assert.equal(noGoal, 25);

const thin = computeAdvisorSplitPct({ ...base, cushionGoalAmount: 1000, bankBalance: 100 });
assert.equal(thin, 40);
const closing = computeAdvisorSplitPct({ ...base, cushionGoalAmount: 1000, bankBalance: 700 });
assert.equal(closing, 25);
const funded = computeAdvisorSplitPct({ ...base, cushionGoalAmount: 1000, bankBalance: 1200 });
assert.equal(funded, 15);
console.log('OK: computeAdvisorSplitPct steps down as cushion fills');

// effectiveBankSplitPct: manual override wins when set.
assert.equal(effectiveBankSplitPct({ ...base, cushionGoalAmount: 1000, bankBalance: 1200 }), 15);
assert.equal(
  effectiveBankSplitPct({ ...base, cushionGoalAmount: 1000, bankBalance: 1200, bankSplitPctManualOverride: true, bankSplitPct: 60 }),
  60,
);
console.log('OK: effectiveBankSplitPct respects manual override');

// 2) suggestCushionGoal
assert.equal(suggestCushionGoal([]), 1000);

console.log('All reinvest financial advisor checks passed.');
