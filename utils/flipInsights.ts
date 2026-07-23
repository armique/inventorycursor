/**
 * Flip insights: suggested eBay list prices (fee-aware), sale-speed analytics,
 * and “buy these first” from historically fast profitable flips.
 */

import { InventoryItem, ItemStatus } from '../types';
import { roundMoney } from '../services/financialAggregation';
import {
  loadFlipFees,
  listPricesForPocket,
  pocketFromEbayListPrice,
  sanitizePocketAgainstBuy,
  suggestChannelPrices,
  totalEbayFeePct,
  type FlipFeeSettings,
} from './flipCoach';
import { productModelKeys } from './inventorySoldComps';
import { resolveSalePlatform } from './salePlatform';

export type SuggestedEbayPrice = {
  ebayList: number;
  kleinList: number;
  pocketTarget: number;
  feePct: number;
  compCount: number;
  /** true when value came from a stored snapshot on the item */
  fromSnapshot: boolean;
};

export function suggestionPatchFromPrice(
  suggestion: SuggestedEbayPrice
): Partial<InventoryItem> {
  return {
    suggestedEbayListPrice: suggestion.ebayList,
    suggestedKleinListPrice: suggestion.kleinList,
    suggestedPocketTarget: suggestion.pocketTarget,
    suggestedFeePct: suggestion.feePct,
    suggestedCompCount: suggestion.compCount,
    suggestedPriceSource: suggestion.compCount > 0 ? 'flip_coach' : 'cost_fallback',
    suggestedPriceUpdatedAt: new Date().toISOString(),
  };
}

function daysBetween(buyDate?: string, sellDate?: string): number | null {
  if (!buyDate || !sellDate) return null;
  const a = new Date(buyDate).getTime();
  const b = new Date(sellDate).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.max(1, Math.round((b - a) / 86400000));
}

function pocketProfit(item: InventoryItem): number | null {
  const sell = Number(item.sellPrice) || 0;
  if (sell <= 0) return null;
  const fee = Number(item.feeAmount) || 0;
  const buy = Number(item.buyPrice) || 0;
  return roundMoney(sell - fee - buy);
}

/** Minimum markup on buy (pocket / KA list). Never suggest thinner than this. */
export const MIN_SUGGEST_MARGIN = 0.3;
/** Default cost-based target markup (middle of the 40–50% band). */
export const TARGET_SUGGEST_MARGIN = 0.45;
/**
 * Hard ceiling vs buy. Sold comps / child sums above this (e.g. €140 on a €48 kit)
 * are rejected and replaced with the ~45% cost target.
 */
export const MAX_SUGGEST_MARGIN = 0.6;

/** Bundle/PC cost: parent buy, or sum of parts when parent buy is empty. */
export function effectiveSuggestionBuy(
  item: InventoryItem,
  children: InventoryItem[] = []
): number {
  const own = Number(item.buyPrice) || 0;
  if (!children.length) return own > 0 ? own : 0;
  const childSum = children.reduce((s, c) => s + (Number(c.buyPrice) || 0), 0);
  return Math.max(own, childSum);
}

/** Clean listing prices (e.g. €35 / €40 / €50) — rounds up, with tiny float slack. */
export function roundListPriceUp(euro: number): number {
  if (!(euro > 0) || !Number.isFinite(euro)) return 0;
  if (euro < 15) return Math.ceil(euro - 1e-9);
  const step = euro < 500 ? 5 : 10;
  const floored = Math.floor(euro / step + 1e-9) * step;
  // Treat values within €0.05 of a step as already clean (float noise from buy × 1.45).
  if (euro - floored < 0.05) return floored;
  return Math.ceil(euro / step - 1e-9) * step;
}

function minPocketForBuy(buy: number): number {
  return buy > 0 ? roundMoney(buy * (1 + MIN_SUGGEST_MARGIN)) : 0;
}

function maxPocketForBuy(buy: number): number {
  return buy > 0 ? roundMoney(buy * (1 + MAX_SUGGEST_MARGIN)) : Number.POSITIVE_INFINITY;
}

function withRoundedLists(
  suggestion: SuggestedEbayPrice,
  feePct: number
): SuggestedEbayPrice {
  const fee = Number.isFinite(suggestion.feePct) ? suggestion.feePct : feePct;
  const klein = roundListPriceUp(suggestion.kleinList);
  // Keep eBay high enough that after fees you still pocket at least the KA amount.
  const ebayFromPocket = listPricesForPocket(klein, fee).ebay;
  const ebay = roundListPriceUp(Math.max(suggestion.ebayList, ebayFromPocket));
  return {
    ...suggestion,
    kleinList: klein,
    ebayList: ebay,
    pocketTarget: klein,
    feePct: fee,
  };
}

function costBasedSuggestion(buy: number, feePct: number): SuggestedEbayPrice | null {
  if (!(buy > 0)) return null;
  const pocket = roundMoney(buy * (1 + TARGET_SUGGEST_MARGIN));
  const lists = listPricesForPocket(pocket, feePct);
  return withRoundedLists(
    {
      ebayList: lists.ebay,
      kleinList: lists.kleinanzeigen,
      pocketTarget: pocket,
      feePct,
      compCount: 0,
      fromSnapshot: false,
    },
    feePct
  );
}

/**
 * Enforce 30–60% margin band vs buy. Below 30% or above 60% → cost-based ~45%.
 * Also reject wildly high comps via sanitizePocketAgainstBuy.
 */
export function finalizeSuggestionAgainstBuy(
  raw: SuggestedEbayPrice,
  buy: number,
  feePct: number
): SuggestedEbayPrice | null {
  if (!(raw.ebayList > 0) || !(raw.kleinList > 0)) {
    return costBasedSuggestion(buy, feePct);
  }

  let pocket = roundMoney(Math.max(0, raw.pocketTarget || raw.kleinList));
  let compCount = raw.compCount;
  const fee = Number.isFinite(raw.feePct) ? raw.feePct : feePct;
  const minPocket = minPocketForBuy(buy);
  const maxPocket = maxPocketForBuy(buy);

  if (compCount > 0 && buy > 0) {
    const sane = sanitizePocketAgainstBuy(pocket, buy, compCount);
    if (sane.clamped) {
      return costBasedSuggestion(buy, fee);
    }
    pocket = sane.pocket;
  }

  const ebayPocket = pocketFromEbayListPrice(raw.ebayList, fee);
  // Outside the 30–60% band on pocket/KA → ~45% cost target.
  // Do not cap eBay list the same way: EB is intentionally higher to cover fees.
  if (
    buy > 0 &&
    (pocket < minPocket ||
      pocket > maxPocket ||
      raw.kleinList < minPocket ||
      raw.kleinList > maxPocket ||
      ebayPocket < minPocket)
  ) {
    return costBasedSuggestion(buy, fee);
  }

  if (compCount > 0 && pocket !== raw.pocketTarget) {
    const lists = listPricesForPocket(pocket, fee);
    return withRoundedLists(
      {
        ebayList: lists.ebay,
        kleinList: lists.kleinanzeigen,
        pocketTarget: pocket,
        feePct: fee,
        compCount,
        fromSnapshot: false,
      },
      fee
    );
  }

  return withRoundedLists(
    {
      ebayList: roundMoney(raw.ebayList),
      kleinList: roundMoney(raw.kleinList),
      pocketTarget: pocket,
      feePct: fee,
      compCount,
      fromSnapshot: raw.fromSnapshot,
    },
    fee
  );
}

/**
 * Suggested eBay list price for an inventory row.
 * Prefer a stored snapshot; otherwise derive from Flip Coach comps + fee %.
 * Bundles/PCs: prefer comps on the container name; else sum child suggestions.
 * Always floors against buy cost so chips never recommend a loss.
 */
export function resolveSuggestedEbayList(
  item: InventoryItem,
  allItems: InventoryItem[],
  fees: FlipFeeSettings = loadFlipFees(),
  children: InventoryItem[] = []
): SuggestedEbayPrice | null {
  const feePct = totalEbayFeePct(fees);
  const buy = effectiveSuggestionBuy(item, children);

  if (
    item.suggestedEbayListPrice != null &&
    Number.isFinite(item.suggestedEbayListPrice) &&
    item.suggestedEbayListPrice > 0
  ) {
    const fee = item.suggestedFeePct ?? feePct;
    const pocket = roundMoney(
      item.suggestedPocketTarget ||
        pocketFromEbayListPrice(item.suggestedEbayListPrice, fee)
    );
    // Kleinanzeigen has 0% fees — suggest the pocket amount (lower than eBay list).
    const klein = roundMoney(
      item.suggestedKleinListPrice || pocket || item.suggestedEbayListPrice
    );
    const fromSnap = finalizeSuggestionAgainstBuy(
      {
        ebayList: roundMoney(item.suggestedEbayListPrice),
        kleinList: klein,
        pocketTarget: pocket,
        feePct: fee,
        compCount: item.suggestedCompCount ?? 0,
        fromSnapshot: true,
      },
      buy,
      fee
    );
    if (fromSnap) return fromSnap;
  }

  const name = (item.name || '').trim();
  if (name.length >= 3 && !item.isPC && !item.isBundle) {
    const suggestion = suggestChannelPrices(allItems, name, fees, {
      category: item.category,
      subCategory: item.subCategory,
    });
    if (suggestion.compCount > 0 && suggestion.ebayList > 0) {
      const finalized = finalizeSuggestionAgainstBuy(
        {
          ebayList: suggestion.ebayList,
          kleinList: suggestion.kleinList,
          pocketTarget: suggestion.pocketTarget,
          feePct: suggestion.ebayFeePct,
          compCount: suggestion.compCount,
          fromSnapshot: false,
        },
        buy,
        feePct
      );
      if (finalized) return finalized;
    }
    return costBasedSuggestion(buy, feePct);
  }

  // Containers: only use title comps when there are no parts yet.
  // Long "PC Bundle · …" titles often match richer sold kits and inflate the chip.
  if ((item.isPC || item.isBundle) && name.length >= 3 && children.length === 0) {
    const suggestion = suggestChannelPrices(allItems, name, fees, {
      category: item.category,
      subCategory: item.subCategory,
    });
    if (suggestion.compCount >= 2 && suggestion.ebayList > 0) {
      const finalized = finalizeSuggestionAgainstBuy(
        {
          ebayList: suggestion.ebayList,
          kleinList: suggestion.kleinList,
          pocketTarget: suggestion.pocketTarget,
          feePct: suggestion.ebayFeePct,
          compCount: suggestion.compCount,
          fromSnapshot: false,
        },
        buy,
        feePct
      );
      if (finalized && finalized.compCount > 0) return finalized;
    }
  }

  if (children.length) {
    let ebay = 0;
    let klein = 0;
    let pocket = 0;
    let comps = 0;
    let any = false;
    for (const child of children) {
      const s = resolveSuggestedEbayList(child, allItems, fees, []);
      if (!s) continue;
      any = true;
      ebay += s.ebayList;
      klein += s.kleinList;
      pocket += s.pocketTarget;
      comps += s.compCount;
    }
    if (any) {
      const finalized = finalizeSuggestionAgainstBuy(
        {
          ebayList: roundMoney(ebay),
          kleinList: roundMoney(klein),
          pocketTarget: roundMoney(pocket),
          feePct,
          compCount: comps,
          fromSnapshot: false,
        },
        buy,
        feePct
      );
      if (finalized) return finalized;
    }
  }

  return costBasedSuggestion(buy, feePct);
}

/** Build a map of suggested eBay € for in-stock rows (capped for UI performance). */
export function buildSuggestedEbayMap(
  items: InventoryItem[],
  fees: FlipFeeSettings = loadFlipFees(),
  opts?: { limit?: number; childrenByParent?: Map<string, InventoryItem[]> }
): Map<string, SuggestedEbayPrice> {
  const limit = opts?.limit ?? 400;
  const map = new Map<string, SuggestedEbayPrice>();
  const stock = items.filter(
    (i) =>
      (i.status === ItemStatus.IN_STOCK || i.status === ItemStatus.ORDERED) &&
      !i.isDraft
  );
  // Prefer bundles/PCs first so container rows always get chips in a large inventory.
  const ordered = [...stock].sort((a, b) => {
    const score = (i: InventoryItem) => (i.isPC || i.isBundle ? 0 : 1);
    return score(a) - score(b);
  });
  let n = 0;
  for (const item of ordered) {
    if (n >= limit) break;
    const children = opts?.childrenByParent?.get(item.id) || [];
    const s = resolveSuggestedEbayList(item, items, fees, children);
    if (!s) continue;
    map.set(item.id, s);
    n += 1;
  }
  return map;
}

export type FlipSaleRecord = {
  itemId: string;
  name: string;
  category: string;
  daysToSell: number;
  profit: number;
  soldPrice: number;
  suggestedPrice: number | null;
  /** 100 = sold exactly at suggestion; lower = farther away */
  priceAccuracyPct: number | null;
  soldVsSuggestedDeltaPct: number | null;
};

export type FlipInsightsSummary = {
  soldWithTiming: number;
  avgDaysToSell: number;
  medianDaysToSell: number;
  avgProfit: number;
  avgPriceAccuracyPct: number | null;
  withSuggestion: number;
  fastest: FlipSaleRecord[];
  bestProfitPerDay: FlipSaleRecord[];
};

function productGroupKey(item: InventoryItem): string {
  const keys = productModelKeys(item.name || '');
  if (keys[0]) return keys[0];
  return (item.name || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s+-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
}

export function buildFlipSaleRecords(items: InventoryItem[]): FlipSaleRecord[] {
  const out: FlipSaleRecord[] = [];
  for (const item of items) {
    if (item.isPC || item.isBundle) continue;
    if (item.status !== ItemStatus.SOLD && item.status !== ItemStatus.TRADED) continue;
    const days = daysBetween(item.buyDate, item.sellDate || item.containerSoldDate);
    const profit = pocketProfit(item);
    const soldPrice = Number(item.sellPrice) || 0;
    if (days == null || profit == null || soldPrice <= 0) continue;

    const suggested =
      item.suggestedEbayListPrice != null && item.suggestedEbayListPrice > 0
        ? item.suggestedEbayListPrice
        : null;
    let priceAccuracyPct: number | null = null;
    let soldVsSuggestedDeltaPct: number | null = null;
    if (suggested != null && suggested > 0) {
      const delta = (soldPrice - suggested) / suggested;
      soldVsSuggestedDeltaPct = roundMoney(delta * 100);
      // Accuracy: 100 when exact; decays with absolute % error (cap at 0)
      priceAccuracyPct = Math.max(0, roundMoney(100 - Math.abs(delta) * 100));
    }

    out.push({
      itemId: item.id,
      name: item.name,
      category: item.subCategory || item.category || 'Other',
      daysToSell: days,
      profit,
      soldPrice,
      suggestedPrice: suggested,
      priceAccuracyPct,
      soldVsSuggestedDeltaPct,
    });
  }
  return out;
}

export function summarizeFlipInsights(items: InventoryItem[]): FlipInsightsSummary {
  const records = buildFlipSaleRecords(items);
  if (!records.length) {
    return {
      soldWithTiming: 0,
      avgDaysToSell: 0,
      medianDaysToSell: 0,
      avgProfit: 0,
      avgPriceAccuracyPct: null,
      withSuggestion: 0,
      fastest: [],
      bestProfitPerDay: [],
    };
  }
  const days = [...records.map((r) => r.daysToSell)].sort((a, b) => a - b);
  const mid = Math.floor(days.length / 2);
  const medianDaysToSell =
    days.length % 2 ? days[mid] : Math.round((days[mid - 1] + days[mid]) / 2);
  const avgDaysToSell = Math.round(
    days.reduce((a, v) => a + v, 0) / days.length
  );
  const avgProfit = roundMoney(
    records.reduce((a, r) => a + r.profit, 0) / records.length
  );
  const withAcc = records.filter((r) => r.priceAccuracyPct != null);
  const avgPriceAccuracyPct = withAcc.length
    ? roundMoney(
        withAcc.reduce((a, r) => a + (r.priceAccuracyPct as number), 0) / withAcc.length
      )
    : null;

  const fastest = [...records].sort((a, b) => a.daysToSell - b.daysToSell).slice(0, 8);
  const bestProfitPerDay = [...records]
    .map((r) => ({ r, ppd: r.profit / Math.max(r.daysToSell, 1) }))
    .sort((a, b) => b.ppd - a.ppd)
    .slice(0, 8)
    .map((x) => x.r);

  return {
    soldWithTiming: records.length,
    avgDaysToSell,
    medianDaysToSell,
    avgProfit,
    avgPriceAccuracyPct,
    withSuggestion: withAcc.length,
    fastest,
    bestProfitPerDay,
  };
}

export type BuyFirstProduct = {
  key: string;
  label: string;
  soldCount: number;
  avgDaysToSell: number;
  avgProfit: number;
  profitPerDay: number;
  avgSoldPrice: number;
  inStock: number;
  advice: string;
};

/** Product-level “buy these first” from historically fast, profitable flips. */
export function computeBuyFirstProducts(
  items: InventoryItem[],
  limit = 10
): BuyFirstProduct[] {
  const soldBuckets = new Map<
    string,
    { label: string; profits: number[]; days: number[]; soldPrices: number[] }
  >();
  const inStockCount = new Map<string, number>();

  for (const item of items) {
    if (item.isPC || item.isBundle || item.isDraft) continue;
    const key = productGroupKey(item);
    if (!key || key.length < 3) continue;

    if (item.status === ItemStatus.IN_STOCK || item.status === ItemStatus.ORDERED) {
      inStockCount.set(key, (inStockCount.get(key) || 0) + 1);
      continue;
    }
    if (item.status !== ItemStatus.SOLD && item.status !== ItemStatus.TRADED) continue;

    const days = daysBetween(item.buyDate, item.sellDate || item.containerSoldDate);
    const profit = pocketProfit(item);
    const soldPrice = Number(item.sellPrice) || 0;
    if (days == null || profit == null || soldPrice <= 0) continue;

    // Prefer eBay-sold history for “what to buy for eBay flips”
    const platform = resolveSalePlatform(item);
    if (platform !== 'ebay.de' && platform !== 'kleinanzeigen.de' && platform !== 'unknown') {
      continue;
    }

    const bucket = soldBuckets.get(key) || {
      label: item.name,
      profits: [],
      days: [],
      soldPrices: [],
    };
    if (item.name.length < bucket.label.length) bucket.label = item.name;
    bucket.profits.push(profit);
    bucket.days.push(days);
    bucket.soldPrices.push(soldPrice);
    soldBuckets.set(key, bucket);
  }

  return Array.from(soldBuckets.entries())
    .map(([key, b]) => {
      const soldCount = b.profits.length;
      const avgProfit = b.profits.reduce((a, v) => a + v, 0) / soldCount;
      const avgDaysToSell = b.days.reduce((a, v) => a + v, 0) / b.days.length;
      const avgSoldPrice = b.soldPrices.reduce((a, v) => a + v, 0) / soldCount;
      const profitPerDay = avgProfit / Math.max(avgDaysToSell, 2);
      const inStock = inStockCount.get(key) || 0;
      let advice = 'Watch';
      if (avgProfit >= 20 && avgDaysToSell <= 18 && soldCount >= 2) {
        advice = inStock === 0 ? 'Buy first — fastest flips' : 'Restock — proven seller';
      } else if (avgProfit >= 12 && avgDaysToSell <= 30) {
        advice = 'Good to buy';
      } else if (avgDaysToSell > 40) {
        advice = 'Slow mover';
      }
      return {
        key,
        label: b.label,
        soldCount,
        avgDaysToSell: Math.round(avgDaysToSell),
        avgProfit: roundMoney(avgProfit),
        profitPerDay: roundMoney(profitPerDay),
        avgSoldPrice: roundMoney(avgSoldPrice),
        inStock,
        advice,
      };
    })
    .filter((r) => r.soldCount >= 2 && r.avgProfit > 0)
    .sort((a, b) => b.profitPerDay - a.profitPerDay || a.avgDaysToSell - b.avgDaysToSell)
    .slice(0, limit);
}
