import { ItemStatus, type InventoryItem, type Expense, type TaxMode } from '../types';
import { isRealizedDisposal } from './itemDisposition';
import { roundMoney, shouldSkipForAggregatedSaleLine } from '../services/financialAggregation';
import { filterOperatingExpenses } from './expenseCategories';
import { yearMonthKeyFromDate } from './calendarDate';
import { variantKeyForItem, type ReinvestGroup } from './reinvestAnalysis';

export interface CapitalPlanningState {
  bankBalance: number;
  circulationBalance: number;
  cushionGoalAmount: number;
  bankSplitPct: number;
  bankSplitPctManualOverride: boolean;
}

export const DEFAULT_BANK_SPLIT_PCT = 25;

export function defaultCapitalPlanningState(): CapitalPlanningState {
  return {
    bankBalance: 0,
    circulationBalance: 0,
    cushionGoalAmount: 0,
    bankSplitPct: DEFAULT_BANK_SPLIT_PCT,
    bankSplitPctManualOverride: false,
  };
}

export function loadCapitalPlanningState(): CapitalPlanningState {
  try {
    const raw = localStorage.getItem('capital_planning_v1');
    if (!raw) return defaultCapitalPlanningState();
    const parsed = JSON.parse(raw);
    return { ...defaultCapitalPlanningState(), ...parsed };
  } catch {
    return defaultCapitalPlanningState();
  }
}

export function saveCapitalPlanningState(state: CapitalPlanningState): void {
  try {
    localStorage.setItem('capital_planning_v1', JSON.stringify(state));
  } catch {
    /* quota / storage unavailable */
  }
}

/** Suggests a 3-month operating expense cushion goal based on operating expenses history. */
export function suggestCushionGoal(expenses: Expense[], ref: Date = new Date()): number {
  const operating = filterOperatingExpenses(expenses);
  if (!operating.length) return 1000;
  const monthSums = new Map<string, number>();
  for (const e of operating) {
    const k = yearMonthKeyFromDate(e.date || '');
    if (k) {
      monthSums.set(k, (monthSums.get(k) || 0) + (Number(e.amount) || 0));
    }
  }
  if (!monthSums.size) return 1000;
  const avgMonthly = Array.from(monthSums.values()).reduce((a, b) => a + b, 0) / monthSums.size;
  return roundMoney(Math.max(500, avgMonthly * 3));
}

/**
 * Computes average monthly net profit across active months (or last 6 months).
 */
export function computeAvgMonthlyProfit(
  items: InventoryItem[],
  expenses: Expense[],
  taxMode: TaxMode,
): number {
  const monthlyProfit = new Map<string, number>();
  const sold = items.filter(
    (i) => isRealizedDisposal(i) && !shouldSkipForAggregatedSaleLine(i, items),
  );
  for (const i of sold) {
    const ym = yearMonthKeyFromDate(i.sellDate || '');
    if (!ym) continue;
    const profit = (Number(i.sellPrice) || 0) - (Number(i.buyPrice) || 0);
    monthlyProfit.set(ym, (monthlyProfit.get(ym) || 0) + profit);
  }

  const operating = filterOperatingExpenses(expenses);
  for (const e of operating) {
    const ym = yearMonthKeyFromDate(e.date || '');
    if (!ym) continue;
    monthlyProfit.set(ym, (monthlyProfit.get(ym) || 0) - (Number(e.amount) || 0));
  }

  if (!monthlyProfit.size) return 0;
  const values = Array.from(monthlyProfit.values());
  const sum = values.reduce((a, b) => a + b, 0);
  return roundMoney(sum / values.length);
}

/** Computes dynamic advisor recommendation for profit split into safety bank vs working capital. */
export function computeAdvisorSplitPct(state: CapitalPlanningState): number {
  if (state.cushionGoalAmount <= 0) return DEFAULT_BANK_SPLIT_PCT;
  const ratio = state.bankBalance / state.cushionGoalAmount;
  if (ratio < 0.5) return 40;
  if (ratio < 1.0) return 25;
  return 15;
}

export function effectiveBankSplitPct(state: CapitalPlanningState): number {
  if (state.bankSplitPctManualOverride) return state.bankSplitPct;
  return computeAdvisorSplitPct(state);
}

export interface ConcentrationWarning {
  hasWarning: boolean;
  topVariantName?: string;
  topVariantPct?: number;
  totalActiveStockValue: number;
}

/** Warns if a single product variant accounts for >35% of total active inventory capital. */
export function computeConcentrationWarning(items: InventoryItem[]): ConcentrationWarning {
  const inStock = items.filter(
    (i) => i.status === ItemStatus.IN_STOCK && !i.is_trash,
  );
  const totalValue = inStock.reduce((sum, i) => sum + (Number(i.buyPrice) || 0), 0);
  if (totalValue <= 0) return { hasWarning: false, totalActiveStockValue: 0 };

  const byVariant = new Map<string, { name: string; value: number }>();
  for (const item of inStock) {
    const key = variantKeyForItem(item);
    const curr = byVariant.get(key) || { name: item.name, value: 0 };
    curr.value += Number(item.buyPrice) || 0;
    byVariant.set(key, curr);
  }

  let maxVariant = { name: '', value: 0 };
  for (const v of byVariant.values()) {
    if (v.value > maxVariant.value) {
      maxVariant = v;
    }
  }

  const pct = Math.round((maxVariant.value / totalValue) * 100);
  return {
    hasWarning: pct >= 35,
    topVariantName: maxVariant.name,
    topVariantPct: pct,
    totalActiveStockValue: roundMoney(totalValue),
  };
}

export interface BreakEvenTimer {
  itemId: string;
  name: string;
  daysInStock: number;
  expectedDays: number;
  status: 'within' | 'approaching' | 'overdue';
}

/** Computes break-even holding timers based on category / variant velocity. */
export function computeBreakEvenTimers(
  items: InventoryItem[],
  variants: ReinvestGroup[],
  refDate: Date = new Date(),
): BreakEvenTimer[] {
  const inStock = items.filter((i) => i.status === ItemStatus.IN_STOCK && !i.is_trash && i.buyDate);
  const velocityMap = new Map<string, number>();
  for (const v of variants) {
    velocityMap.set(v.key, v.avgDaysToSell || 21);
  }

  return inStock.map((i) => {
    const buyTime = new Date(i.buyDate!).getTime();
    const daysInStock = Math.max(0, Math.floor((refDate.getTime() - buyTime) / (1000 * 60 * 60 * 24)));
    const key = variantKeyForItem(i);
    const expectedDays = velocityMap.get(key) || 21;

    let status: 'within' | 'approaching' | 'overdue' = 'within';
    if (daysInStock > expectedDays * 1.5) {
      status = 'overdue';
    } else if (daysInStock > expectedDays) {
      status = 'approaching';
    }

    return {
      itemId: i.id,
      name: i.name,
      daysInStock,
      expectedDays,
      status,
    };
  }).sort((a, b) => b.daysInStock - a.daysInStock);
}

export interface GrowthProjectionPoint {
  month: number;
  bank: number;
  circulation: number;
  total: number;
}

/** Simulates working capital & safety bank trajectory over 6, 12, or 24 months. */
export function simulateGrowth(
  initialBank: number,
  initialCirculation: number,
  avgMonthlyProfit: number,
  splitPct: number,
  horizonMonths: number = 12,
): GrowthProjectionPoint[] {
  const points: GrowthProjectionPoint[] = [];
  let currentBank = initialBank;
  let currentCirculation = initialCirculation;

  const monthlyBankShare = avgMonthlyProfit * (splitPct / 100);
  const monthlyCircShare = avgMonthlyProfit * ((100 - splitPct) / 100);

  for (let m = 0; m <= horizonMonths; m++) {
    points.push({
      month: m,
      bank: roundMoney(currentBank),
      circulation: roundMoney(currentCirculation),
      total: roundMoney(currentBank + currentCirculation),
    });
    currentBank += monthlyBankShare;
    currentCirculation += monthlyCircShare;
  }

  return points;
}
