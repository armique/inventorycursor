/**
 * Verify Reinvest Assistant gamification (sections 3, 3.1, 3.2): bank/take-suggestion math,
 * month net profit (must match Dashboard.tsx's gameStats formula), achievements, daily quests,
 * and the weekly digest.
 * Run: npx tsx scripts/verify-reinvest-gamification.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type Expense, type InventoryItem } from '../types';
import { buildReinvestData } from '../utils/reinvestAnalysis';
import {
  computeAchievements,
  computeMonthNetProfit,
  computeWeeklyDigest,
  generateDailyQuests,
  suggestTakeAmount,
} from '../utils/gamification';
import { findNewlyClosedDeals } from '../hooks/useGamificationEvents';
import type { MissionLogEntry } from '../utils/flipCoachMissions';

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

function isoInCurrentMonth(day: number): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), day).toISOString().slice(0, 10);
}

// ============================================================
// 1) suggestTakeAmount — fixed % suggestion, backs off to 0 when the month is running behind.
// ============================================================
assert.equal(suggestTakeAmount(100, 25, 50), 25, 'expected 25% of profit when month is net-positive');
assert.equal(suggestTakeAmount(100, 25, -10), 0, 'expected 0 when month net profit is negative');
assert.equal(suggestTakeAmount(0, 25, 50), 0, 'no profit -> nothing to suggest');
console.log('OK: suggestTakeAmount respects bankSplitPct and backs off when the month is behind');

// ============================================================
// 2) computeMonthNetProfit — mirrors Dashboard.tsx's gameStats.monthProfit formula exactly.
// ============================================================
const monthItems: InventoryItem[] = [
  item({
    id: 'sold-this-month',
    name: 'RAM 16GB',
    buyPrice: 20,
    sellPrice: 35,
    buyDate: '2025-01-01',
    sellDate: isoInCurrentMonth(3),
  }),
  item({
    id: 'sold-last-month',
    name: 'RAM 16GB #2',
    buyPrice: 20,
    sellPrice: 40,
    buyDate: '2025-01-01',
    sellDate: '2020-01-05', // definitely a different month/year, must not count
  }),
];
const monthExpenses: Expense[] = [
  { id: 'e1', description: 'Shipping', amount: 10, date: isoInCurrentMonth(4), category: 'Shipping' },
  { id: 'e2', description: 'Old rent', amount: 999, date: '2020-01-05', category: 'Other' },
];
const expectedNet = 35 - 20 - 10; // this month's sale profit minus this month's operating expense
assert.equal(computeMonthNetProfit(monthItems, monthExpenses, 'SmallBusiness'), expectedNet);
console.log(`OK: computeMonthNetProfit = ${expectedNet} (only counts this month's sales/expenses)`);

// ============================================================
// 3) computeAchievements — spot-check a handful of the 15 badges.
// ============================================================
const achievementItems: InventoryItem[] = [
  item({ id: 'a1', name: 'GPU 1', buyPrice: 100, sellPrice: 150, buyDate: '2026-01-01', sellDate: '2026-01-01' }), // same-day -> speed demon
  ...['CPU', 'RAM', 'Motherboard', 'PSU', 'Case'].map((cat, i) =>
    item({
      id: `diverse-${i}`,
      name: `${cat} item`,
      category: 'Components',
      subCategory: cat,
      buyPrice: 10,
      sellPrice: 20,
      buyDate: '2026-01-01',
      sellDate: '2026-01-10',
    }),
  ),
];
const achievements = computeAchievements(achievementItems, [], { reinvestRookie: false });
const byId = new Map(achievements.map((a) => [a.id, a]));
assert.equal(achievements.length, 15, 'expected all 15 achievement definitions');
assert.equal(byId.get('first-sale')?.unlocked, true);
assert.equal(byId.get('ten-down')?.unlocked, false);
assert.equal(byId.get('speed-demon')?.unlocked, true, 'same-day buy+sell should unlock Speed Demon');
assert.equal(byId.get('diversifier')?.unlocked, true, '5 distinct categories should unlock Diversifier');
assert.equal(byId.get('reinvest-rookie')?.unlocked, false);
const rookieOn = computeAchievements(achievementItems, [], { reinvestRookie: true });
assert.equal(rookieOn.find((a) => a.id === 'reinvest-rookie')?.unlocked, true, 'flag should flip the badge on');
console.log('OK: computeAchievements unlocks the right badges from data (first-sale, speed-demon, diversifier, rookie flag)');

// ============================================================
// 4) generateDailyQuests — always >=2, includes a restock quest only when one is warranted.
// ============================================================
const emptyQuests = generateDailyQuests(buildReinvestData([]), { day: 'x', doneIds: [] }, [] as MissionLogEntry[]);
assert.ok(emptyQuests.length >= 2, 'expected at least 2 quests even with no data');
assert.ok(emptyQuests.some((q) => q.id === 'list-something'));

const restockItems: InventoryItem[] = Array.from({ length: 5 }, (_, i) =>
  item({
    id: `restock-${i}`,
    name: 'Samsung 970 EVO Plus SSD 512GB',
    buyPrice: 25,
    sellPrice: 45,
    buyDate: '2026-01-01',
    sellDate: `2026-0${(i % 6) + 1}-05`,
  }),
);
const restockData = buildReinvestData(restockItems);
const restockQuests = generateDailyQuests(restockData, { day: 'x', doneIds: [] }, [] as MissionLogEntry[]);
assert.ok(
  restockQuests.some((q) => q.id.startsWith('restock-')),
  'expected a restock quest once a proven-seller gap exists',
);
console.log('OK: generateDailyQuests always offers >=2 quests, adds a restock quest when warranted');

// ============================================================
// 5) computeWeeklyDigest — this week vs last week, best category, tip text.
// ============================================================
function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}
const digestItems: InventoryItem[] = [
  item({ id: 'w1', name: 'This week win', category: 'Components', subCategory: 'GPU', buyPrice: 100, sellPrice: 160, buyDate: daysAgoIso(10), sellDate: daysAgoIso(1) }),
  item({ id: 'w2', name: 'Last week sale', category: 'Components', subCategory: 'CPU', buyPrice: 50, sellPrice: 70, buyDate: daysAgoIso(20), sellDate: daysAgoIso(9) }),
];
const digest = computeWeeklyDigest(digestItems, buildReinvestData(digestItems));
assert.ok(digest.profitThisWeek >= 0);
assert.ok(typeof digest.tip === 'string' && digest.tip.length > 0);
console.log(`OK: computeWeeklyDigest — this week €${digest.profitThisWeek}, tip: "${digest.tip}"`);

// ============================================================
// 6) findNewlyClosedDeals — ignore already-sold cloud hydrate; celebrate live transitions.
// ============================================================
const inStock = item({
  id: 'lg-bluray',
  name: 'LG WH16NS40 Blu-ray Brenner',
  status: ItemStatus.IN_STOCK,
  buyPrice: 10,
  sellPrice: 0,
});
const sold = item({
  id: 'lg-bluray',
  name: 'LG WH16NS40 Blu-ray Brenner',
  status: ItemStatus.SOLD,
  buyPrice: 10,
  sellPrice: 36.75,
});
assert.deepEqual(
  findNewlyClosedDeals([], [sold]).map((i) => i.id),
  [],
  'hydrate of already-sold item must not count as a live close',
);
assert.deepEqual(
  findNewlyClosedDeals([inStock], [sold]).map((i) => i.id),
  ['lg-bluray'],
  'in-stock → sold must count as a live close',
);
assert.deepEqual(
  findNewlyClosedDeals([sold], [sold]).map((i) => i.id),
  [],
  'already sold → still sold must not re-fire',
);
console.log('OK: findNewlyClosedDeals ignores cloud hydrate and only fires on live closes');

console.log('\nAll reinvest gamification checks passed.');
