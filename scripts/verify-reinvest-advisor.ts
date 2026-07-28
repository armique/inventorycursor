/**
 * Verify Reinvest Assistant financial advisor (sections 4, 4.1, 4.2): dynamic bank/circulation
 * split, cushion suggestion, concentration warning, growth projection, break-even timers, CSV
 * export shape, and the automatic circulation credit/debit ledger functions.
 * Run: npx tsx scripts/verify-reinvest-advisor.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type Expense, type InventoryItem } from '../types';
import { buildReinvestData } from '../utils/reinvestAnalysis';
import {
  applyCirculationCredit,
  applyPurchaseDebit,
  computeAdvisorSplitPct,
  computeAvgMonthlyProfit,
  computeBreakEvenTimers,
  computeConcentrationWarning,
  defaultGamificationState,
  effectiveBankSplitPct,
  simulateGrowth,
  suggestCushionGoal,
} from '../utils/gamification';
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

// ============================================================
// 1) computeAdvisorSplitPct — staircase by cushion-fill %, explainable reason text each time.
// ============================================================
const base = defaultGamificationState();
const noGoal = computeAdvisorSplitPct(base);
assert.equal(noGoal.pct, 25);
assert.equal(noGoal.cushionFilledPct, null);

const thin = computeAdvisorSplitPct({ ...base, cushionGoalAmount: 1000, bankBalance: 100 }); // 10%
assert.equal(thin.pct, 50);
const building = computeAdvisorSplitPct({ ...base, cushionGoalAmount: 1000, bankBalance: 400 }); // 40%
assert.equal(building.pct, 35);
const closing = computeAdvisorSplitPct({ ...base, cushionGoalAmount: 1000, bankBalance: 700 }); // 70%
assert.equal(closing.pct, 25);
const funded = computeAdvisorSplitPct({ ...base, cushionGoalAmount: 1000, bankBalance: 1200 }); // over 100%
assert.equal(funded.pct, 15);
assert.ok(funded.reason.toLowerCase().includes('fund'));
console.log('OK: computeAdvisorSplitPct steps down as the cushion fills, with a plain-language reason each time');

// effectiveBankSplitPct: manual override wins when set.
assert.equal(effectiveBankSplitPct({ ...base, cushionGoalAmount: 1000, bankBalance: 1200 }), 15);
assert.equal(
  effectiveBankSplitPct({ ...base, cushionGoalAmount: 1000, bankBalance: 1200, bankSplitPctManualOverride: true, bankSplitPct: 60 }),
  60,
);
console.log('OK: effectiveBankSplitPct respects a manual override over the advisor suggestion');

// ============================================================
// 2) suggestCushionGoal — 3x avg operating expenses, sane fallback with no history.
// ============================================================
assert.equal(suggestCushionGoal([]), 500, 'expected the flat fallback with no expense history');
function isoMonthsAgo(months: number, day = 5): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - months, day).toISOString().slice(0, 10);
}
const expenseHistory: Expense[] = [0, 1, 2].map((m, i) => ({
  id: `e${i}`,
  description: 'Shipping',
  amount: 100,
  date: isoMonthsAgo(m),
  category: 'Shipping',
}));
assert.equal(suggestCushionGoal(expenseHistory), 300, 'expected 3x the ~€100/mo average');
console.log('OK: suggestCushionGoal = 3x average monthly operating expenses, falls back to €500 with no data');

// ============================================================
// 3) computeConcentrationWarning — fires on a lopsided recent buying pattern, not on a mixed one.
// ============================================================
const lopsided: InventoryItem[] = Array.from({ length: 5 }, (_, i) =>
  item({ id: `lop-${i}`, name: `GPU ${i}`, category: 'Components', subCategory: 'GPU', buyPrice: 100, buyDate: isoMonthsAgo(0, 1 + i) }),
);
assert.ok(computeConcentrationWarning(lopsided)?.sharePct === 100);

const mixed: InventoryItem[] = [
  item({ id: 'm1', name: 'GPU', category: 'Components', subCategory: 'GPU', buyPrice: 100, buyDate: isoMonthsAgo(0, 1) }),
  item({ id: 'm2', name: 'CPU', category: 'Components', subCategory: 'CPU', buyPrice: 100, buyDate: isoMonthsAgo(0, 2) }),
  item({ id: 'm3', name: 'RAM', category: 'Components', subCategory: 'RAM', buyPrice: 100, buyDate: isoMonthsAgo(0, 3) }),
];
assert.equal(computeConcentrationWarning(mixed), null, 'evenly spread buying should not warn');
console.log('OK: computeConcentrationWarning fires only on a genuinely lopsided recent buying pattern');

// ============================================================
// 4) simulateGrowth — linear projection, month-N matches a hand calc.
// ============================================================
const points = simulateGrowth(100, 200, 300, 25, 6);
assert.equal(points.length, 7); // month 0..6
assert.equal(points[0].bankBalance, 100);
assert.equal(points[0].circulationBalance, 200);
// month 6: bank = 100 + 6*300*0.25 = 550; circulation = 200 + 6*300*0.75 = 1550
assert.equal(points[6].bankBalance, 550);
assert.equal(points[6].circulationBalance, 1550);
console.log('OK: simulateGrowth projects linearly from avg monthly profit and matches a hand calc at month 6');

// ============================================================
// 5) computeAvgMonthlyProfit — only averages months that actually had a sale.
// ============================================================
const avgItems: InventoryItem[] = [
  item({ id: 'p1', name: 'RAM 1', buyPrice: 20, sellPrice: 40, buyDate: isoMonthsAgo(1, 1), sellDate: isoMonthsAgo(1, 5) }),
  item({ id: 'p2', name: 'RAM 2', buyPrice: 20, sellPrice: 60, buyDate: isoMonthsAgo(2, 1), sellDate: isoMonthsAgo(2, 5) }),
];
const avgProfit = computeAvgMonthlyProfit(avgItems, [], 'SmallBusiness', 6);
assert.equal(avgProfit, 30, 'expected (20 + 40) / 2 across the two months that had sales');
console.log(`OK: computeAvgMonthlyProfit = €${avgProfit} (averages only months with real sales)`);

// ============================================================
// 6) computeBreakEvenTimers — status thresholds (within / approaching / overdue).
// ============================================================
const beItems: InventoryItem[] = [
  ...['a', 'b', 'c'].map((s, i) =>
    item({ id: `sold-${s}`, name: 'Crucial MX500 SSD 256GB', buyPrice: 15, sellPrice: 25, buyDate: '2025-01-01', sellDate: `2025-01-1${i + 1}` }),
  ), // avg 10 days to sell
  item({ id: 'within', name: 'Crucial MX500 SSD 256GB', buyPrice: 15, status: ItemStatus.IN_STOCK, buyDate: isoMonthsAgo(0, 27) }), // ~1 day held
  item({ id: 'overdue', name: 'Crucial MX500 SSD 256GB', buyPrice: 15, status: ItemStatus.IN_STOCK, buyDate: isoMonthsAgo(1, 1) }), // well past avg
];
const timers = computeBreakEvenTimers(beItems, buildReinvestData(beItems).variants);
const byId = new Map(timers.map((t) => [t.itemId, t]));
assert.equal(byId.get('within')?.status, 'within');
assert.equal(byId.get('overdue')?.status, 'overdue');
console.log('OK: computeBreakEvenTimers marks a fresh item "within" and a stale one "overdue"');

// ============================================================
// 7) Circulation ledger — automatic credit/debit, no floor.
// ============================================================
let ledger = defaultGamificationState();
ledger = applyCirculationCredit(ledger, 50);
assert.equal(ledger.circulationBalance, 50);
ledger = applyPurchaseDebit(ledger, 80);
assert.equal(ledger.circulationBalance, -30, 'spending more than tracked circulation should go negative, not clamp');
console.log('OK: applyCirculationCredit/applyPurchaseDebit move circulationBalance with no artificial floor');

// ============================================================
// 8) buildTradeHistoryCsv — header + one row per realized sale, sorted by sell date.
// ============================================================
const csvItems: InventoryItem[] = [
  item({ id: 'c1', name: 'GPU X', buyPrice: 100, sellPrice: 150, buyDate: '2026-01-01', sellDate: '2026-02-01', platformSold: 'ebay.de' }),
  item({ id: 'c2', name: 'Not sold', buyPrice: 50, status: ItemStatus.IN_STOCK }),
];
const csv = buildTradeHistoryCsv(csvItems, 'SmallBusiness');
const lines = csv.split('\r\n');
assert.equal(lines.length, 2, 'header + exactly one realized sale row (the in-stock item must be excluded)');
assert.ok(lines[0].startsWith('Buy date,Sell date,Name'));
assert.ok(lines[1].includes('GPU X') && lines[1].includes('50')); // profit = 150-100 = 50
console.log('OK: buildTradeHistoryCsv includes only realized sales with the expected columns');

console.log('\nAll reinvest advisor checks passed.');
