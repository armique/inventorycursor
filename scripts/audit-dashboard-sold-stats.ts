/**
 * Recompute dashboard KPIs from live sold rows and list mismatches.
 * Run: npx tsx scripts/audit-dashboard-sold-stats.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { ItemStatus, type InventoryItem, type Expense, type TaxMode } from '../types';
import {
  computeItemProfitBeforeOverhead,
  computeSoldTabMargin,
  getSoldContainerDisplayTotals,
  isSoldWithProportionalChildren,
  resolvedSaleRevenue,
  roundMoney,
  shouldSkipForAggregatedSaleLine,
  shouldSkipForInventoryCostLine,
} from '../services/financialAggregation';
import { isRealizedDisposal } from '../utils/itemDisposition';
import { saleProceedsFromItemFields } from '../utils/saleProceeds';
import { toLocalCalendarDateKey, yearMonthKeyFromDate, currentLocalYearMonth } from '../utils/calendarDate';
import { filterOperatingExpenses, sumOperatingExpenseAmount } from '../utils/expenseCategories';
import { countOrdersByPlatform, groupSalesByPlatform, sumRevenueByPlatform } from '../utils/salePlatform';

const dumpPath = path.join(process.cwd(), 'scripts', 'output', 'live-dashboard-audit.json');
const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8')) as {
  items: InventoryItem[];
  expenses: Expense[];
  taxMode: TaxMode;
  monthlyGoal: number;
  dash: { timeFilter: string | null; customStart: string | null; customEnd: string | null };
};

const items = dump.items;
const expenses = dump.expenses;
const taxMode = dump.taxMode || 'SmallBusiness';
const timeFilter = dump.dash.timeFilter || 'ALL';

function periodBounds(filter: string): { startKey: string; endKey: string; label: string } {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  let start = new Date(0);
  let endUse = end;
  if (filter === 'THIS_MONTH') {
    start = new Date(end.getFullYear(), end.getMonth(), 1);
    start.setHours(0, 0, 0, 0);
  } else if (filter === 'LAST_MONTH') {
    start = new Date(end.getFullYear(), end.getMonth() - 1, 1);
    start.setHours(0, 0, 0, 0);
    endUse = new Date(end.getFullYear(), end.getMonth(), 0, 23, 59, 59, 999);
  } else if (filter === 'LAST_7') {
    start = new Date();
    start.setDate(end.getDate() - 6);
    start.setHours(0, 0, 0, 0);
  } else if (filter === 'LAST_30') {
    start = new Date();
    start.setDate(end.getDate() - 29);
    start.setHours(0, 0, 0, 0);
  } else if (filter === 'LAST_90') {
    start = new Date();
    start.setDate(end.getDate() - 89);
    start.setHours(0, 0, 0, 0);
  }
  return {
    startKey: toLocalCalendarDateKey(start),
    endKey: toLocalCalendarDateKey(endUse),
    label: filter,
  };
}

function inPeriod(item: InventoryItem, startKey: string, endKey: string): boolean {
  const raw = isRealizedDisposal(item) ? item.sellDate : item.buyDate;
  if (!raw) return false;
  const k = toLocalCalendarDateKey(raw);
  return Boolean(k && k >= startKey && k <= endKey);
}

function kpis(sold: InventoryItem[], ops: Expense[]) {
  const revenue = roundMoney(sold.reduce((s, i) => s + resolvedSaleRevenue(i), 0));
  const hubRevenue = revenue;
  const saleProfit = roundMoney(sold.reduce((s, i) => s + computeItemProfitBeforeOverhead(i, taxMode), 0));
  const pocketProfit = roundMoney(sold.reduce((s, i) => s + computeSoldTabMargin(i), 0));
  const storedProfit = roundMoney(sold.reduce((s, i) => s + (Number(i.profit) || 0), 0));
  const expTotal = roundMoney(ops.reduce((s, e) => s + Number(e.amount || 0), 0));
  return {
    count: sold.length,
    revenue,
    hubRevenue,
    saleProfit,
    pocketProfit,
    storedProfit,
    expTotal,
    netProfit: roundMoney(saleProfit - expTotal),
    pocketNet: roundMoney(pocketProfit - expTotal),
  };
}

const allRealized = items.filter((i) => isRealizedDisposal(i));
const countedAll = allRealized.filter((i) => !shouldSkipForAggregatedSaleLine(i, items));
const skippedAll = allRealized.filter((i) => shouldSkipForAggregatedSaleLine(i, items));

const { startKey, endKey, label } = periodBounds(timeFilter);
const soldPeriod = countedAll.filter((i) => inPeriod(i, startKey, endKey));
const opsPeriod = filterOperatingExpenses(
  expenses.filter((e) => {
    const k = toLocalCalendarDateKey(e.date);
    return Boolean(k && k >= startKey && k <= endKey);
  })
);

const thisMonthKey = currentLocalYearMonth();
const soldMonth = countedAll.filter((i) => i.sellDate && yearMonthKeyFromDate(i.sellDate) === thisMonthKey);
const opsMonth = filterOperatingExpenses(
  expenses.filter((e) => e.date && yearMonthKeyFromDate(e.date) === thisMonthKey)
);

const period = kpis(soldPeriod, opsPeriod);
const allTime = kpis(countedAll, filterOperatingExpenses(expenses));
const month = kpis(soldMonth, opsMonth);

const inStock = items.filter((i) => i.status === ItemStatus.IN_STOCK && !shouldSkipForInventoryCostLine(i, items));
const inventoryValue = roundMoney(inStock.reduce((s, i) => s + Number(i.buyPrice || 0), 0));

type RowIssue = {
  id: string;
  name: string;
  kind: string;
  detail: string;
  sell?: number;
  buy?: number;
  storedProfit?: number;
  pocket?: number;
  dashProfit?: number;
};

const issues: RowIssue[] = [];

for (const item of countedAll) {
  const p = saleProceedsFromItemFields(item);
  const sell = Number(item.sellPrice) || 0;
  const buyer = p.buyerTotalEur;
  const pocket = computeSoldTabMargin(item);
  const dashP = computeItemProfitBeforeOverhead(item, taxMode);
  const stored = item.profit != null ? Number(item.profit) : null;

  if (buyer != null && Math.abs(buyer - sell) >= 0.05) {
    issues.push({
      id: item.id,
      name: item.name,
      kind: 'sell_vs_hub_total',
      detail: `sellPrice €${sell.toFixed(2)} ≠ Hub Gesamtbetrag €${buyer.toFixed(2)}`,
      sell,
      buy: Number(item.buyPrice) || 0,
      storedProfit: stored ?? undefined,
      pocket,
      dashProfit: dashP,
    });
  }

  if (stored != null && Math.abs(stored - pocket) >= 0.05) {
    issues.push({
      id: item.id,
      name: item.name,
      kind: 'stored_profit_vs_pocket',
      detail: `stored profit €${stored.toFixed(2)} ≠ Sold-tab €${pocket.toFixed(2)}`,
      sell,
      buy: Number(item.buyPrice) || 0,
      storedProfit: stored,
      pocket,
      dashProfit: dashP,
    });
  }

  if (item.status === ItemStatus.SOLD && sell < 0.01 && !item.isPC && !item.isBundle) {
    issues.push({
      id: item.id,
      name: item.name,
      kind: 'zero_sell',
      detail: 'Sold row has no sell price',
      sell,
      buy: Number(item.buyPrice) || 0,
      pocket,
      dashProfit: dashP,
    });
  }
}

const bundleGaps: RowIssue[] = [];
for (const parent of items) {
  if (!isRealizedDisposal(parent)) continue;
  if (!(parent.isPC || parent.isBundle || (parent.componentIds && parent.componentIds.length))) continue;
  if (!isSoldWithProportionalChildren(parent, items)) continue;
  const totals = getSoldContainerDisplayTotals(parent, items, taxMode);
  const children = (parent.componentIds || [])
    .map((id) => items.find((i) => i.id === id))
    .filter((c): c is InventoryItem => !!c && c.parentContainerId === parent.id);
  const childSell = roundMoney(children.reduce((s, c) => s + (Number(c.sellPrice) || 0), 0));
  const parentSell = Number(parent.sellPrice) || 0;
  const hubBuyer = parent.saleProceeds?.buyerTotalEur;
  const countedChildren = children.filter((c) => !shouldSkipForAggregatedSaleLine(c, items));
  const countedChildSell = roundMoney(countedChildren.reduce((s, c) => s + (Number(c.sellPrice) || 0), 0));
  const parentCounted = !shouldSkipForAggregatedSaleLine(parent, items);
  const expectedRev = totals.sellPrice ?? parentSell;
  const dashRev = parentCounted ? parentSell : countedChildSell;
  if (expectedRev != null && Math.abs(dashRev - expectedRev) >= 0.05) {
    bundleGaps.push({
      id: parent.id,
      name: parent.name,
      kind: 'bundle_revenue_gap',
      detail: `dashboard counts €${dashRev.toFixed(2)} (parentCounted=${parentCounted}, kids=${countedChildren.length}) vs Hub/display €${expectedRev.toFixed(2)} (childSum €${childSell.toFixed(2)}, parentSell €${parentSell.toFixed(2)}, hub €${hubBuyer ?? '—'})`,
      sell: parentSell,
    });
  }
}

const doubleCounted = skippedAll.filter((i) => {
  if (!i.parentContainerId) return false;
  const parent = items.find((p) => p.id === i.parentContainerId);
  return Boolean(parent && !shouldSkipForAggregatedSaleLine(parent, items) && isRealizedDisposal(parent));
});

const gifted = countedAll.filter((i) => i.status === ItemStatus.GIFTED);
const traded = countedAll.filter((i) => i.status === ItemStatus.TRADED);

const platforms = {
  groups: Object.fromEntries(
    Object.entries(groupSalesByPlatform(soldPeriod)).map(([k, v]) => [k, v.length])
  ),
  revenue: sumRevenueByPlatform(soldPeriod),
  orders: countOrdersByPlatform(soldPeriod),
};

const out = {
  taxMode,
  timeFilter,
  period: { startKey, endKey, label },
  thisMonthKey,
  counts: {
    items: items.length,
    realized: allRealized.length,
    countedAll: countedAll.length,
    skippedAll: skippedAll.length,
    soldPeriod: soldPeriod.length,
    inStock: inStock.length,
    gifted: gifted.length,
    traded: traded.length,
  },
  periodKpis: period,
  monthKpis: month,
  allTimeKpis: allTime,
  inventoryValue,
  lifetimeNetAfterExpenses: roundMoney(allTime.saleProfit - sumOperatingExpenseAmount(expenses)),
  platforms,
  issueCounts: {
    sellVsHub: issues.filter((i) => i.kind === 'sell_vs_hub_total').length,
    storedVsPocket: issues.filter((i) => i.kind === 'stored_profit_vs_pocket').length,
    zeroSell: issues.filter((i) => i.kind === 'zero_sell').length,
    bundleGaps: bundleGaps.length,
    skippedChildrenWithCountedParent: doubleCounted.length,
  },
  issues: issues.slice(0, 80),
  bundleGaps: bundleGaps.slice(0, 40),
  skippedSample: skippedAll.slice(0, 15).map((i) => ({
    id: i.id,
    name: i.name,
    status: i.status,
    isPC: i.isPC,
    isBundle: i.isBundle,
    parentContainerId: i.parentContainerId,
    sellPrice: i.sellPrice,
  })),
};

fs.writeFileSync(path.join(process.cwd(), 'scripts', 'output', 'dashboard-audit-result.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  taxMode,
  timeFilter,
  period: out.period,
  counts: out.counts,
  periodKpis: out.periodKpis,
  monthKpis: out.monthKpis,
  allTimeKpis: {
    count: out.allTimeKpis.count,
    revenue: out.allTimeKpis.revenue,
    hubRevenue: out.allTimeKpis.hubRevenue,
    saleProfit: out.allTimeKpis.saleProfit,
    pocketProfit: out.allTimeKpis.pocketProfit,
    storedProfit: out.allTimeKpis.storedProfit,
    expTotal: out.allTimeKpis.expTotal,
    netProfit: out.allTimeKpis.netProfit,
  },
  inventoryValue,
  issueCounts: out.issueCounts,
  platforms: out.platforms,
}, null, 2));
