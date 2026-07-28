/**
 * Reinvest Assistant gamification + financial advisor (sections 3, 3.1, 3.2, 4, 4.1, 4.2): daily
 * budget, quests, achievements, bank/circulation ledger, cushion-driven dynamic split advice,
 * concentration warnings, growth projection, break-even timers, weekly digest. Pure data
 * functions only — persistence (localStorage + Firestore) and the event toast layer live in
 * hooks/useGamificationEvents.ts and components/gamification/*. None of this is personal
 * financial advice — see the disclaimer surfaced in components/reinvest/ReinvestAdvisorTab.tsx.
 */
import { ItemStatus, type InventoryItem, type TaxMode } from '../types';
import type { Expense } from '../types';
import { isRealizedDisposal } from './itemDisposition';
import { roundMoney, shouldSkipForAggregatedSaleLine, computeItemProfitBeforeOverhead } from '../services/financialAggregation';
import { filterOperatingExpenses } from './expenseCategories';
import { yearMonthKeyFromDate, currentLocalYearMonth, todayLocalDateKey } from './calendarDate';
import { localDayKey, computeListStreak, getMissionProgress, type MissionLogEntry } from './flipCoachMissions';
import { resolveSalePlatform } from './salePlatform';
import { variantKeyForItem, type ReinvestData } from './reinvestAnalysis';

export const GAMIFICATION_STORAGE_KEY = 'reinvest_gamification_v1';
export const DEFAULT_BANK_SPLIT_PCT = 25;

export type WithdrawalEntry = { id: string; amount: number; at: string };
export type MonthlySnapshot = { month: string; bankBalance: number; circulationBalance: number };

export type GamificationState = {
  bankBalance: number;
  /** Manual value, only used when bankSplitPctManualOverride is true — otherwise the advisor's
   * computeAdvisorSplitPct() drives the effective %. See effectiveBankSplitPct(). */
  bankSplitPct: number;
  bankSplitPctManualOverride: boolean;
  /** Working-capital pool: grows automatically on every sale (the share NOT sent to bank),
   * shrinks automatically when a new purchase appears in inventory. Section 4. */
  circulationBalance: number;
  /** User's target safety cushion for the bank; 0 = not set yet (suggestCushionGoal offers one). */
  cushionGoalAmount: number;
  withdrawalHistory: WithdrawalEntry[];
  dailyBudget: { date: string; amount: number; spentVirtual: number };
  quests: { day: string; doneIds: string[] };
  /** Set once the user confirms a purchase from a Reinvest card — feeds the Reinvest Rookie badge. */
  reinvestRookie: boolean;
  lastExpansionSignalAt?: string;
  lastDigestShownWeek?: string;
  lastSnapshotMonth?: string;
  monthlySnapshots: MonthlySnapshot[];
};

export function defaultGamificationState(): GamificationState {
  return {
    bankBalance: 0,
    bankSplitPct: DEFAULT_BANK_SPLIT_PCT,
    bankSplitPctManualOverride: false,
    circulationBalance: 0,
    cushionGoalAmount: 0,
    withdrawalHistory: [],
    dailyBudget: { date: todayLocalDateKey(), amount: 0, spentVirtual: 0 },
    quests: { day: localDayKey(), doneIds: [] },
    reinvestRookie: false,
    monthlySnapshots: [],
  };
}

export function loadGamificationStateLocal(): GamificationState {
  try {
    const raw = localStorage.getItem(GAMIFICATION_STORAGE_KEY);
    if (!raw) return defaultGamificationState();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaultGamificationState();
    return { ...defaultGamificationState(), ...parsed };
  } catch {
    return defaultGamificationState();
  }
}

export function saveGamificationStateLocal(state: GamificationState): void {
  try {
    localStorage.setItem(GAMIFICATION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota / private mode */
  }
}

/** Resets the daily budget / quest-completion bookkeeping when the calendar day has rolled over. */
export function ensureFreshDay(state: GamificationState): GamificationState {
  const today = todayLocalDateKey();
  const day = localDayKey();
  let next = state;
  if (next.dailyBudget.date !== today) {
    next = { ...next, dailyBudget: { date: today, amount: next.dailyBudget.amount, spentVirtual: 0 } };
  }
  if (next.quests.day !== day) {
    next = { ...next, quests: { day, doneIds: [] } };
  }
  return next;
}

/** Appends a bank/circulation snapshot when the calendar month rolls over — the data source for
 * the "dynamics over time" chart in section 4 without needing a background job. */
export function ensureFreshMonth(state: GamificationState, ref: Date = new Date()): GamificationState {
  const ym = currentLocalYearMonth(ref);
  if (state.lastSnapshotMonth === ym) return state;
  const snapshot: MonthlySnapshot = {
    month: ym,
    bankBalance: state.bankBalance,
    circulationBalance: state.circulationBalance,
  };
  return {
    ...state,
    lastSnapshotMonth: ym,
    monthlySnapshots: [...state.monthlySnapshots, snapshot].slice(-24),
  };
}

// ---------------------------------------------------------------------------
// Bank ledger (3.1's "deal closed" event)
// ---------------------------------------------------------------------------

/** Whole-account net profit for the current month — mirrors Dashboard.tsx's `gameStats.monthProfit`
 * exactly (same primitives: computeItemProfitBeforeOverhead, filterOperatingExpenses,
 * shouldSkipForAggregatedSaleLine) so the two never disagree, without touching Dashboard.tsx. */
export function computeMonthNetProfit(
  items: InventoryItem[],
  expenses: Expense[],
  taxMode: TaxMode,
  ref: Date = new Date(),
): number {
  const ym = currentLocalYearMonth(ref);
  const soldForRollup = items.filter((i) => isRealizedDisposal(i) && !shouldSkipForAggregatedSaleLine(i, items));
  const currentMonthItems = soldForRollup.filter((i) => !!i.sellDate && yearMonthKeyFromDate(i.sellDate) === ym);
  const currentMonthExpenses = filterOperatingExpenses(
    expenses.filter((e) => !!e.date && yearMonthKeyFromDate(e.date) === ym),
  );
  const monthSaleProfit = roundMoney(
    currentMonthItems.reduce((acc, i) => acc + computeItemProfitBeforeOverhead(i, taxMode), 0),
  );
  const monthExpensesTotal = roundMoney(
    currentMonthExpenses.reduce((acc, e) => acc + (Number(e.amount) || 0), 0),
  );
  return roundMoney(monthSaleProfit - monthExpensesTotal);
}

/** Bank-share suggestion for the "deal closed" toast: `bankSplitPct` of this sale's profit, but
 * backs off to 0 (suggest taking nothing, leave the whole thing as circulation) when the account
 * is running behind on expenses this month. The remainder (profit - this) is credited to
 * circulation automatically, regardless of what the user picks — see applyCirculationCredit. */
export function suggestTakeAmount(profit: number, bankSplitPct: number, monthNetProfit: number): number {
  if (profit <= 0) return 0;
  if (monthNetProfit < 0) return 0;
  return roundMoney(profit * (bankSplitPct / 100));
}

/** Confirms the bank-destined share as savings. */
export function addToBank(state: GamificationState, amount: number): GamificationState {
  if (!(amount > 0)) return state;
  return { ...state, bankBalance: roundMoney(state.bankBalance + amount) };
}

/** The non-bank share of every sale's profit — applied automatically, no user choice involved. */
export function applyCirculationCredit(state: GamificationState, amount: number): GamificationState {
  if (!(amount > 0)) return state;
  return { ...state, circulationBalance: roundMoney(state.circulationBalance + amount) };
}

/** A confirmed new purchase draws down working capital. No floor — going negative just means
 * spending outpaced what this tracker has seen credited so far; it's informational, not a gate. */
export function applyPurchaseDebit(state: GamificationState, amount: number): GamificationState {
  if (!(amount > 0)) return state;
  return { ...state, circulationBalance: roundMoney(state.circulationBalance - amount) };
}

/** "Take for yourself" — logged as real income taken out; never touched the bank balance. */
export function takeToPocket(state: GamificationState, amount: number): GamificationState {
  if (!(amount > 0)) return state;
  const entry: WithdrawalEntry = { id: `w-${Date.now()}`, amount: roundMoney(amount), at: new Date().toISOString() };
  return { ...state, withdrawalHistory: [entry, ...state.withdrawalHistory].slice(0, 200) };
}

export function withdrawnThisMonth(state: GamificationState, ref: Date = new Date()): number {
  const ym = currentLocalYearMonth(ref);
  return roundMoney(
    state.withdrawalHistory
      .filter((w) => yearMonthKeyFromDate(w.at) === ym)
      .reduce((acc, w) => acc + w.amount, 0),
  );
}

// ---------------------------------------------------------------------------
// Financial advisor (4.1) — general guidance only, never personal financial advice, never
// suggests specific investment products; only ever distributes between bank / circulation.
// ---------------------------------------------------------------------------

const CUSHION_MONTHS_TARGET = 3;
const CUSHION_FALLBACK_AMOUNT = 500;

/** Suggested cushion benchmark: N months of typical operating spend. Falls back to a flat
 * starter amount when there's no expense history yet to average. */
export function suggestCushionGoal(expenses: Expense[], monthsBack = 6): number {
  const now = new Date();
  const monthlyTotals: number[] = [];
  for (let i = 0; i < monthsBack; i++) {
    const ref = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = currentLocalYearMonth(ref);
    const total = filterOperatingExpenses(expenses.filter((e) => !!e.date && yearMonthKeyFromDate(e.date) === ym))
      .reduce((acc, e) => acc + (Number(e.amount) || 0), 0);
    if (total > 0) monthlyTotals.push(total);
  }
  if (!monthlyTotals.length) return CUSHION_FALLBACK_AMOUNT;
  const avg = monthlyTotals.reduce((a, b) => a + b, 0) / monthlyTotals.length;
  return roundMoney(avg * CUSHION_MONTHS_TARGET);
}

export type AdvisorSplit = { pct: number; reason: string; cushionFilledPct: number | null };

/** Staircase, explainable-in-plain-words recommendation — not a formula the user has to trust
 * blindly. Higher % while the cushion is thin (liquidity first), lower once it's funded. */
export function computeAdvisorSplitPct(state: GamificationState): AdvisorSplit {
  const goal = state.cushionGoalAmount;
  if (!(goal > 0)) {
    return {
      pct: DEFAULT_BANK_SPLIT_PCT,
      reason: 'Set a cushion goal in Advisor to get a recommendation tailored to your progress — using a sensible default for now.',
      cushionFilledPct: null,
    };
  }
  const filled = Math.max(0, Math.min(1, state.bankBalance / goal));
  const filledPct = Math.round(filled * 100);
  if (filled >= 1) {
    return {
      pct: 15,
      reason: `Cushion fully funded (€${Math.round(goal)}) — recommend saving less and reinvesting more into stock.`,
      cushionFilledPct: filledPct,
    };
  }
  if (filled >= 0.66) {
    return {
      pct: 25,
      reason: `Cushion ${filledPct}% funded — still saving a solid share while you close the gap.`,
      cushionFilledPct: filledPct,
    };
  }
  if (filled >= 0.33) {
    return {
      pct: 35,
      reason: `Cushion ${filledPct}% funded — saving more than usual while you build it up.`,
      cushionFilledPct: filledPct,
    };
  }
  return {
    pct: 50,
    reason: `Cushion only ${filledPct}% funded — liquidity matters more than growth right now.`,
    cushionFilledPct: filledPct,
  };
}

/** Manual override wins if the user set one; otherwise follow the advisor's dynamic suggestion. */
export function effectiveBankSplitPct(state: GamificationState): number {
  return state.bankSplitPctManualOverride ? state.bankSplitPct : computeAdvisorSplitPct(state).pct;
}

export type ConcentrationWarning = { warning: string; topCategory: string; sharePct: number } | null;

/** Soft heads-up when recent buying leans almost entirely on one category — informational, not
 * a block. Needs at least a few recent purchases before it says anything. */
export function computeConcentrationWarning(items: InventoryItem[], windowDays = 90): ConcentrationWarning {
  const cutoff = Date.now() - windowDays * 86400000;
  const recentBuys = items.filter((i) => !i.isDraft && i.buyDate && new Date(i.buyDate).getTime() >= cutoff);
  if (recentBuys.length < 3) return null;
  const totalSpend = recentBuys.reduce((s, i) => s + (Number(i.buyPrice) || 0), 0);
  if (totalSpend <= 0) return null;
  const byCat = new Map<string, number>();
  for (const i of recentBuys) {
    const cat = i.subCategory || i.category || 'Other';
    byCat.set(cat, (byCat.get(cat) || 0) + (Number(i.buyPrice) || 0));
  }
  const [topCategory, topSpend] = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];
  const sharePct = Math.round((topSpend / totalSpend) * 100);
  if (sharePct < 70) return null;
  return {
    warning: `${sharePct}% of your buying in the last ${windowDays} days went into "${topCategory}" — if demand for that category dips, a lot of capital is tied up in one place.`,
    topCategory,
    sharePct,
  };
}

/** Average of the last N calendar months that actually had sales — the real-data anchor for the
 * growth simulator, instead of an abstract example number. */
export function computeAvgMonthlyProfit(
  items: InventoryItem[],
  expenses: Expense[],
  taxMode: TaxMode,
  months = 6,
): number {
  const now = new Date();
  const values: number[] = [];
  for (let i = 0; i < months; i++) {
    const ref = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = currentLocalYearMonth(ref);
    const hadSale = items.some((it) => isRealizedDisposal(it) && it.sellDate && yearMonthKeyFromDate(it.sellDate) === ym);
    if (!hadSale) continue;
    values.push(computeMonthNetProfit(items, expenses, taxMode, ref));
  }
  if (!values.length) return 0;
  return roundMoney(values.reduce((a, b) => a + b, 0) / values.length);
}

export type GrowthProjectionPoint = { month: number; bankBalance: number; circulationBalance: number };

/** Plain linear projection from the account's own average monthly profit — deliberately NOT a
 * fabricated compounding interest rate (this "bank" isn't a real interest-bearing account). */
export function simulateGrowth(
  currentBank: number,
  currentCirculation: number,
  avgMonthlyProfit: number,
  bankSplitPct: number,
  horizonMonths: number,
): GrowthProjectionPoint[] {
  const monthlyProfit = Math.max(0, avgMonthlyProfit);
  const points: GrowthProjectionPoint[] = [
    { month: 0, bankBalance: roundMoney(currentBank), circulationBalance: roundMoney(currentCirculation) },
  ];
  let bank = currentBank;
  let circulation = currentCirculation;
  for (let m = 1; m <= horizonMonths; m++) {
    bank += monthlyProfit * (bankSplitPct / 100);
    circulation += monthlyProfit * (1 - bankSplitPct / 100);
    points.push({ month: m, bankBalance: roundMoney(bank), circulationBalance: roundMoney(circulation) });
  }
  return points;
}

export type BreakEvenTimer = {
  itemId: string;
  name: string;
  category: string;
  daysHeld: number;
  avgDaysToSell: number;
  /** daysHeld / avgDaysToSell * 100, uncapped (UI clamps the bar, not the number). */
  pct: number;
  status: 'within' | 'approaching' | 'overdue';
};

/** Full break-even timer (section 4.2) — every active position with a trustworthy category
 * average, not just the outliers computeAgingListings (2.5) already flags. */
export function computeBreakEvenTimers(items: InventoryItem[], variants: ReinvestData['variants']): BreakEvenTimer[] {
  const byKey = new Map(variants.map((g) => [g.key, g]));
  const now = Date.now();
  const out: BreakEvenTimer[] = [];
  for (const item of items) {
    if (item.isBundle || item.isPC || item.isDraft) continue;
    if (item.status !== ItemStatus.IN_STOCK) continue;
    if (!item.buyDate) continue;
    const group = byKey.get(variantKeyForItem(item));
    if (!group || group.confidence === 'low') continue;
    const daysHeld = Math.max(0, Math.round((now - new Date(item.buyDate).getTime()) / 86400000));
    const pct = group.avgDaysToSell > 0 ? Math.round((daysHeld / group.avgDaysToSell) * 100) : 0;
    const status: BreakEvenTimer['status'] = pct >= 100 ? 'overdue' : pct >= 70 ? 'approaching' : 'within';
    out.push({
      itemId: item.id,
      name: item.name,
      category: item.subCategory || item.category || 'Other',
      daysHeld,
      avgDaysToSell: Math.round(group.avgDaysToSell),
      pct,
      status,
    });
  }
  return out.sort((a, b) => b.pct - a.pct);
}

// ---------------------------------------------------------------------------
// Daily quests
// ---------------------------------------------------------------------------

export type DailyQuest = {
  id: string;
  title: string;
  description: string;
  done: boolean;
  /** true = system detects completion from existing data; false = user checks it off manually. */
  auto: boolean;
};

export function markQuestDone(state: GamificationState, questId: string): GamificationState {
  const day = localDayKey();
  const current = state.quests.day === day ? state.quests : { day, doneIds: [] };
  if (current.doneIds.includes(questId)) return state;
  return { ...state, quests: { day, doneIds: [...current.doneIds, questId] } };
}

/** 2-4 quests/day, deterministic per calendar day: only templates with a real reason to exist
 * are offered (e.g. no restock quest if nothing needs restocking). */
export function generateDailyQuests(
  reinvestData: ReinvestData,
  questState: GamificationState['quests'],
  missionLog: MissionLogEntry[],
): DailyQuest[] {
  const day = localDayKey();
  const doneIds = new Set(questState.day === day ? questState.doneIds : []);
  const missionProgress = getMissionProgress(missionLog, 1);
  const quests: DailyQuest[] = [];

  quests.push({
    id: 'list-something',
    title: 'List something today',
    description: 'Mark one in-stock item as listed (Flip Coach daily mission).',
    done: missionProgress.completedToday >= 1,
    auto: true,
  });

  const restockTarget = reinvestData.variants.find((g) => g.kind === 'variant' && g.currentStock < g.targetStock);
  if (restockTarget) {
    quests.push({
      id: `restock-${restockTarget.key}`,
      title: `Restock: ${restockTarget.label}`,
      description: `You're at ${restockTarget.currentStock}/${restockTarget.targetStock} in stock — find one to buy.`,
      done: restockTarget.currentStock >= restockTarget.targetStock,
      auto: true,
    });
  }

  const stale = reinvestData.agingListings[0];
  if (stale) {
    const id = `check-stale-${stale.itemId}`;
    quests.push({
      id,
      title: `Check on "${stale.name}"`,
      description: `Listed ${stale.daysHeld}d, usually sells in ~${stale.avgDaysToSell}d — bump it or update the price.`,
      done: doneIds.has(id),
      auto: false,
    });
  }

  const hypothesis = reinvestData.variants.find((g) => g.kind === 'hypothesis');
  if (hypothesis) {
    const id = `try-hypothesis-${hypothesis.key}`;
    quests.push({
      id,
      title: `Check fresh listings for "${hypothesis.label}"`,
      description: "You've barely sold this — see what's out there right now.",
      done: doneIds.has(id),
      auto: false,
    });
  }

  if (quests.length < 2) {
    quests.push({
      id: 'browse-cheatsheet',
      title: 'Browse the cheat sheet',
      description: 'Skim the Reinvest cheat sheet for one product you have not tried.',
      done: doneIds.has('browse-cheatsheet'),
      auto: false,
    });
  }

  return quests.slice(0, 4);
}

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------

export type Achievement = {
  id: string;
  label: string;
  description: string;
  icon: string;
  unlocked: boolean;
  progress: number;
  progressLabel: string;
};

function daysBetweenDates(buyDate?: string, sellDate?: string): number | null {
  if (!buyDate || !sellDate) return null;
  const a = new Date(buyDate).getTime();
  const b = new Date(sellDate).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.max(0, Math.round((b - a) / 86400000));
}

/** Sum of (sellPrice - buyPrice) per sold month — gross, not net-of-expenses (kept simple; this
 * feeds a badge, not a financial report). */
function monthlyProfitSeries(items: InventoryItem[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    if (!isRealizedDisposal(item) || !((Number(item.sellPrice) || 0) > 0) || !item.sellDate) continue;
    const ym = yearMonthKeyFromDate(item.sellDate);
    if (!ym) continue;
    const profit = (Number(item.sellPrice) || 0) - (Number(item.buyPrice) || 0);
    map.set(ym, (map.get(ym) || 0) + profit);
  }
  return map;
}

function nextYearMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m, 1); // m is 1-based (Jan=1) -> Date's 0-based month arg lands on next month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function longestPositiveMonthStreak(series: Map<string, number>): number {
  if (!series.size) return 0;
  const months = [...series.keys()].sort();
  let cursor = months[0];
  const last = months[months.length - 1];
  let longest = 0;
  let current = 0;
  let guard = 0;
  while (cursor <= last && guard < 600) {
    current = (series.get(cursor) || 0) > 0 ? current + 1 : 0;
    longest = Math.max(longest, current);
    cursor = nextYearMonth(cursor);
    guard += 1;
  }
  return longest;
}

/** 15 badges, all derived from data already in `items` + the existing Flip Coach mission log —
 * no new event-sourcing needed, except `reinvestRookie` (a one-bit flag set on first confirmed
 * Reinvest purchase). */
export function computeAchievements(
  items: InventoryItem[],
  missionLog: MissionLogEntry[],
  flags: { reinvestRookie: boolean },
): Achievement[] {
  const sold = items.filter((i) => isRealizedDisposal(i) && (Number(i.sellPrice) || 0) > 0);
  const soldCount = sold.length;
  const profits = sold.map((i) => (Number(i.sellPrice) || 0) - (Number(i.buyPrice) || 0));

  const tiered = (id: string, label: string, icon: string, target: number): Achievement => ({
    id,
    label,
    icon,
    description: `Sell ${target} item${target === 1 ? '' : 's'}.`,
    unlocked: soldCount >= target,
    progress: Math.min(100, Math.round((soldCount / target) * 100)),
    progressLabel: `${Math.min(soldCount, target)}/${target}`,
  });

  const speedDemon = sold.some((i) => {
    const d = daysBetweenDates(i.buyDate, i.sellDate);
    return d != null && d <= 1;
  });

  const streak = computeListStreak(missionLog);
  const categories = new Set(sold.map((i) => i.subCategory || i.category || 'Other'));
  const bigFlipProfit = profits.length ? Math.max(...profits) : 0;
  const consistencyStreak = longestPositiveMonthStreak(monthlyProfitSeries(items));

  const bundleCount = items.filter(
    (i) => (i.isBundle || i.isPC) && isRealizedDisposal(i) && (Number(i.sellPrice) || 0) > 0,
  ).length;

  const ebayCount = sold.filter((i) => resolveSalePlatform(i) === 'ebay.de').length;
  const kaCount = sold.filter((i) => resolveSalePlatform(i) === 'kleinanzeigen.de').length;

  const recentSorted = [...sold].sort(
    (a, b) => new Date(b.sellDate || 0).getTime() - new Date(a.sellDate || 0).getTime(),
  );
  const last10 = recentSorted.slice(0, 10);
  const last10Profitable = last10.filter((i) => (Number(i.sellPrice) || 0) - (Number(i.buyPrice) || 0) > 0).length;
  const cleanStreak = last10.length >= 10 && last10Profitable === 10;

  return [
    tiered('first-sale', 'First Sale', 'star', 1),
    tiered('ten-down', 'Ten Down', 'medal', 10),
    tiered('half-century', 'Half Century', 'trophy', 50),
    tiered('century-club', 'Century Club', 'crown', 100),
    {
      id: 'speed-demon',
      label: 'Speed Demon',
      icon: 'zap',
      description: 'Sell an item within 24 hours of buying it.',
      unlocked: speedDemon,
      progress: speedDemon ? 100 : 0,
      progressLabel: speedDemon ? 'Done' : '0/1',
    },
    {
      id: 'week-streak',
      label: 'Week Streak',
      icon: 'flame',
      description: 'List something 7 days in a row.',
      unlocked: streak >= 7,
      progress: Math.min(100, Math.round((streak / 7) * 100)),
      progressLabel: `${Math.min(streak, 7)}/7`,
    },
    {
      id: 'month-streak',
      label: 'Month Streak',
      icon: 'flame',
      description: 'List something 30 days in a row.',
      unlocked: streak >= 30,
      progress: Math.min(100, Math.round((streak / 30) * 100)),
      progressLabel: `${Math.min(streak, 30)}/30`,
    },
    {
      id: 'diversifier',
      label: 'Diversifier',
      icon: 'layers',
      description: 'Sell in 5 different categories.',
      unlocked: categories.size >= 5,
      progress: Math.min(100, Math.round((categories.size / 5) * 100)),
      progressLabel: `${Math.min(categories.size, 5)}/5`,
    },
    {
      id: 'category-master',
      label: 'Category Master',
      icon: 'layers',
      description: 'Sell in 10 different categories.',
      unlocked: categories.size >= 10,
      progress: Math.min(100, Math.round((categories.size / 10) * 100)),
      progressLabel: `${Math.min(categories.size, 10)}/10`,
    },
    {
      id: 'big-flip',
      label: 'Big Flip',
      icon: 'trending-up',
      description: 'Clear €100 profit on a single sale.',
      unlocked: bigFlipProfit >= 100,
      progress: Math.min(100, Math.round((Math.max(0, bigFlipProfit) / 100) * 100)),
      progressLabel: `€${Math.round(Math.max(0, bigFlipProfit))}/€100`,
    },
    {
      id: 'consistency',
      label: 'Consistency',
      icon: 'calendar-check',
      description: '3 months in a row with positive profit.',
      unlocked: consistencyStreak >= 3,
      progress: Math.min(100, Math.round((consistencyStreak / 3) * 100)),
      progressLabel: `${Math.min(consistencyStreak, 3)}/3`,
    },
    {
      id: 'bundle-builder',
      label: 'Bundle Builder',
      icon: 'boxes',
      description: 'Sell 5 bundles or PCs.',
      unlocked: bundleCount >= 5,
      progress: Math.min(100, Math.round((bundleCount / 5) * 100)),
      progressLabel: `${Math.min(bundleCount, 5)}/5`,
    },
    {
      id: 'platform-pro',
      label: 'Platform Pro',
      icon: 'globe',
      description: '5+ sales on both eBay and Kleinanzeigen.',
      unlocked: ebayCount >= 5 && kaCount >= 5,
      progress: Math.min(100, Math.round((Math.min(ebayCount, kaCount) / 5) * 100)),
      progressLabel: `eBay ${Math.min(ebayCount, 5)}/5 · KA ${Math.min(kaCount, 5)}/5`,
    },
    {
      id: 'clean-streak',
      label: 'Clean Streak',
      icon: 'shield-check',
      description: 'Last 10 sales all profitable.',
      unlocked: cleanStreak,
      progress: last10.length ? Math.round((last10Profitable / 10) * 100) : 0,
      progressLabel: `${last10Profitable}/${Math.max(last10.length, 10)}`,
    },
    {
      id: 'reinvest-rookie',
      label: 'Reinvest Rookie',
      icon: 'sparkles',
      description: 'Confirm a purchase from a Reinvest recommendation.',
      unlocked: flags.reinvestRookie,
      progress: flags.reinvestRookie ? 100 : 0,
      progressLabel: flags.reinvestRookie ? 'Done' : '0/1',
    },
  ];
}

// ---------------------------------------------------------------------------
// Weekly digest (3.2)
// ---------------------------------------------------------------------------

export type WeeklyDigestSummary = {
  weekLabel: string;
  profitThisWeek: number;
  profitLastWeek: number;
  profitChangePct: number | null;
  bestCategory: { label: string; profit: number } | null;
  worstCategory: { label: string; profit: number } | null;
  stuckCount: number;
  tip: string;
};

export function computeWeeklyDigest(items: InventoryItem[], reinvestData: ReinvestData): WeeklyDigestSummary {
  const now = new Date();
  const thisMonday = new Date(now);
  const dow = (now.getDay() + 6) % 7;
  thisMonday.setDate(now.getDate() - dow);
  thisMonday.setHours(0, 0, 0, 0);
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);
  const lastSunday = new Date(thisMonday.getTime() - 1);

  const sold = items.filter((i) => isRealizedDisposal(i) && (Number(i.sellPrice) || 0) > 0 && i.sellDate);
  const inRange = (d: Date, start: Date, end: Date) => d >= start && d <= end;
  const thisWeekSold = sold.filter((i) => inRange(new Date(i.sellDate!), thisMonday, now));
  const lastWeekSold = sold.filter((i) => inRange(new Date(i.sellDate!), lastMonday, lastSunday));

  const profitOf = (list: InventoryItem[]) =>
    roundMoney(list.reduce((s, i) => s + (Number(i.sellPrice) || 0) - (Number(i.buyPrice) || 0), 0));
  const profitThisWeek = profitOf(thisWeekSold);
  const profitLastWeek = profitOf(lastWeekSold);
  const profitChangePct =
    profitLastWeek > 0 ? Math.round(((profitThisWeek - profitLastWeek) / profitLastWeek) * 100) : null;

  const byCat = new Map<string, number>();
  for (const item of thisWeekSold) {
    const cat = item.subCategory || item.category || 'Other';
    const profit = (Number(item.sellPrice) || 0) - (Number(item.buyPrice) || 0);
    byCat.set(cat, (byCat.get(cat) || 0) + profit);
  }
  const catEntries = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const bestCategory = catEntries.length ? { label: catEntries[0][0], profit: roundMoney(catEntries[0][1]) } : null;
  const worstCategory =
    catEntries.length > 1
      ? { label: catEntries[catEntries.length - 1][0], profit: roundMoney(catEntries[catEntries.length - 1][1]) }
      : null;

  const restockTip = reinvestData.variants.find((g) => g.kind === 'variant' && g.currentStock < g.targetStock);
  const tip = restockTip
    ? `Try restocking "${restockTip.label}" — it's below your usual stock level.`
    : reinvestData.adjacentCategories.length
      ? `Consider trying ${reinvestData.adjacentCategories[0]} — it keeps showing up in your bundles.`
      : 'Keep an eye on the Reinvest recommendations for next week.';

  return {
    weekLabel: `${thisMonday.toISOString().slice(0, 10)} – today`,
    profitThisWeek,
    profitLastWeek,
    profitChangePct,
    bestCategory,
    worstCategory,
    stuckCount: reinvestData.agingListings.length,
    tip,
  };
}
