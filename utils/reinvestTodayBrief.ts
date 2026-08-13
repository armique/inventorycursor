/**
 * Daily "what to buy / skip / sell / clarify" brief for Reinvest Buy list.
 */
import type { InventoryItem } from '../types';
import { ItemStatus } from '../types';
import type { AnchorBundleGroup, ReinvestGroup } from './reinvestAnalysis';
import { computeReinvestPricing } from './reinvestPricing';
import type { ReinvestFees } from './reinvestFees';
import { defaultMarginForGroup } from './reinvestPricing';
import { roundMoney } from '../services/financialAggregation';
import type { ReinvestSuspicion } from './reinvestSuspicion';
import type { GamificationState } from './gamification';
import { extractPrimaryComponentKey } from './componentKeyExtractor';

export type TodayBuyRow = {
  group: ReinvestGroup | AnchorBundleGroup;
  maxBuy: number | null;
  channel: 'ka' | 'ebay' | 'either';
  why: string;
  confidence: string;
  gated?: string;
};

export type TodaySellRow = {
  item: InventoryItem;
  why: string;
  ageDays: number;
};

export type ReinvestTodayBrief = {
  buy: TodayBuyRow[];
  skip: Array<{ group: ReinvestGroup | AnchorBundleGroup; why: string }>;
  sell: TodaySellRow[];
  clarify: ReinvestSuspicion[];
  capitalNote?: string;
};

function ageDays(buyDate?: string): number {
  if (!buyDate) return 0;
  const t = new Date(buyDate).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.round((Date.now() - t) / 86400000));
}

function preferredChannel(group: ReinvestGroup | AnchorBundleGroup): 'ka' | 'ebay' | 'either' {
  if (group.sellKaCount === 0 && group.sellEbayCount === 0) return 'either';
  if (group.sellEbayCount > group.sellKaCount) return 'ebay';
  if (group.sellKaCount > group.sellEbayCount) return 'ka';
  return 'either';
}

function concentrationCategory(items: InventoryItem[]): string | null {
  const recent = items
    .filter((i) => i.buyDate && i.buyDate >= daysAgoIso(45) && (Number(i.buyPrice) || 0) > 0)
    .slice(0, 80);
  if (recent.length < 4) return null;
  const counts = new Map<string, number>();
  let total = 0;
  for (const i of recent) {
    const match = extractPrimaryComponentKey(i.name || '');
    const key = match?.category || i.subCategory || i.category || 'other';
    const buy = Number(i.buyPrice) || 0;
    counts.set(key, (counts.get(key) || 0) + buy);
    total += buy;
  }
  if (!(total > 0)) return null;
  let best = '';
  let bestAmt = 0;
  for (const [k, v] of counts) {
    if (v > bestAmt) {
      best = k;
      bestAmt = v;
    }
  }
  if (bestAmt / total >= 0.7) return best;
  return null;
}

function daysAgoIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function buildReinvestTodayBrief(params: {
  restock: Array<ReinvestGroup | AnchorBundleGroup>;
  skipped: Array<ReinvestGroup | AnchorBundleGroup>;
  suspicions: ReinvestSuspicion[];
  items: InventoryItem[];
  fees: ReinvestFees;
  gamification?: GamificationState;
  /** When set, prefer kit/standalone filtering for wave 2. */
  intentFilter?: 'standalone' | 'kit' | 'all';
}): ReinvestTodayBrief {
  const { restock, skipped, suspicions, items, fees, gamification, intentFilter = 'all' } = params;

  const dailyLeft =
    gamification != null
      ? Math.max(0, roundMoney(gamification.dailyBudget.amount - gamification.dailyBudget.spentVirtual))
      : null;
  const bankLeft = gamification != null ? Math.max(0, gamification.bankBalance) : null;
  const hotCat = concentrationCategory(items);

  let capitalNote: string | undefined;
  if (dailyLeft != null && gamification && gamification.dailyBudget.amount > 0 && dailyLeft <= 0) {
    capitalNote = 'Daily buy budget is used up — restock suggestions are paused until tomorrow.';
  } else if (hotCat) {
    capitalNote = `Recent buys are heavily concentrated in ${hotCat} — diversify before stacking more.`;
  }

  const filteredRestock = restock.filter((g) => {
    if (intentFilter === 'kit') return g.kind === 'bundle';
    if (intentFilter === 'standalone') return g.kind !== 'bundle';
    return true;
  });

  const buy: TodayBuyRow[] = [];
  for (const g of filteredRestock) {
    if (buy.length >= 5) break;
    if (capitalNote && dailyLeft != null && gamification && gamification.dailyBudget.amount > 0 && dailyLeft <= 0) {
      break;
    }
    if (hotCat && (g.key.startsWith(`${hotCat}:`) || g.category.toLowerCase().includes(hotCat))) {
      continue;
    }
    const margin = defaultMarginForGroup(g);
    const calc = computeReinvestPricing(g, fees, margin);
    const channel = preferredChannel(g);
    const maxBuy = calc.suggestedMaxBuy;
    if (maxBuy != null && dailyLeft != null && gamification && gamification.dailyBudget.amount > 0 && maxBuy > dailyLeft) {
      buy.push({
        group: g,
        maxBuy,
        channel,
        why: `Usually ~€${g.profitPerDay.toFixed(0)}/day after fees · need ${g.targetStock - g.currentStock} more`,
        confidence: g.confidence,
        gated: `Over today's remaining budget (€${dailyLeft})`,
      });
      continue;
    }
    if (maxBuy != null && bankLeft != null && bankLeft > 0 && maxBuy > bankLeft * 0.5 && bankLeft < maxBuy) {
      buy.push({
        group: g,
        maxBuy,
        channel,
        why: `Usually ~€${g.profitPerDay.toFixed(0)}/day after fees`,
        confidence: g.confidence,
        gated: `Above bank cash on hand (€${bankLeft})`,
      });
      continue;
    }
    buy.push({
      group: g,
      maxBuy,
      channel,
      why:
        g.kind === 'bundle'
          ? `Kit pattern · ~€${g.profitPerDay.toFixed(0)}/day · stock ${g.currentStock}/${g.targetStock}`
          : `~€${g.profitPerDay.toFixed(0)}/day after fees · ${Math.round(g.avgDaysToSell)}d typical · stock ${g.currentStock}/${g.targetStock}`,
      confidence: g.confidence,
    });
  }

  const skip = skipped.slice(0, 5).map((g) => ({
    group: g,
    why: g.skipReason || (g.allInclAvgProfit <= 0 ? 'Average pocket loss after fees' : 'Slow for the margin'),
  }));

  const stock = items.filter((i) => i.status === ItemStatus.IN_STOCK && !i.isPC && !i.isBundle && !i.parentContainerId);
  const sellCandidates = stock
    .map((item) => {
      const age = ageDays(item.buyDate);
      const buy = Number(item.buyPrice) || 0;
      let why = '';
      if (age >= 90) why = `Sitting ${age} days — free the cash`;
      else if (item.isDefective) why = 'Defective — price to move or scrap';
      else if (buy >= 80 && age >= 45) why = `€${buy} tied up for ${age} days`;
      return why ? { item, why, ageDays: age } : null;
    })
    .filter((r): r is TodaySellRow => !!r)
    .sort((a, b) => b.ageDays - a.ageDays)
    .slice(0, 5);

  return {
    buy,
    skip,
    sell: sellCandidates,
    clarify: suspicions.slice(0, 6),
    capitalNote,
  };
}
