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

/**
 * Suggested eBay list price for an inventory row.
 * Prefer a stored snapshot; otherwise derive from Flip Coach comps + fee %.
 * Bundles/PCs: prefer comps on the container name; else sum child suggestions.
 */
export function resolveSuggestedEbayList(
  item: InventoryItem,
  allItems: InventoryItem[],
  fees: FlipFeeSettings = loadFlipFees(),
  children: InventoryItem[] = []
): SuggestedEbayPrice | null {
  const feePct = totalEbayFeePct(fees);
  const buy = Number(item.buyPrice) || 0;

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
    return {
      ebayList: roundMoney(item.suggestedEbayListPrice),
      kleinList: klein,
      pocketTarget: pocket,
      feePct: fee,
      compCount: item.suggestedCompCount ?? 0,
      fromSnapshot: true,
    };
  }

  const name = (item.name || '').trim();
  if (name.length >= 3 && !item.isPC && !item.isBundle) {
    const suggestion = suggestChannelPrices(allItems, name, fees, {
      category: item.category,
      subCategory: item.subCategory,
    });
    if (suggestion.compCount > 0 && suggestion.ebayList > 0) {
      return {
        ebayList: suggestion.ebayList,
        kleinList: suggestion.kleinList,
        pocketTarget: suggestion.pocketTarget,
        feePct: suggestion.ebayFeePct,
        compCount: suggestion.compCount,
        fromSnapshot: false,
      };
    }
    if (buy > 0) {
      const pocket = roundMoney(buy * 1.25);
      const lists = listPricesForPocket(pocket, feePct);
      return {
        ebayList: lists.ebay,
        kleinList: lists.kleinanzeigen,
        pocketTarget: pocket,
        feePct,
        compCount: 0,
        fromSnapshot: false,
      };
    }
    return null;
  }

  // Containers: comps on bundle/PC name, else sum children
  if ((item.isPC || item.isBundle) && name.length >= 3) {
    const suggestion = suggestChannelPrices(allItems, name, fees, {
      category: item.category,
      subCategory: item.subCategory,
    });
    if (suggestion.compCount >= 2 && suggestion.ebayList > 0) {
      return {
        ebayList: suggestion.ebayList,
        kleinList: suggestion.kleinList,
        pocketTarget: suggestion.pocketTarget,
        feePct: suggestion.ebayFeePct,
        compCount: suggestion.compCount,
        fromSnapshot: false,
      };
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
      return {
        ebayList: roundMoney(ebay),
        kleinList: roundMoney(klein),
        pocketTarget: roundMoney(pocket),
        feePct,
        compCount: comps,
        fromSnapshot: false,
      };
    }
  }

  if (buy > 0) {
    const pocket = roundMoney(buy * 1.25);
    const lists = listPricesForPocket(pocket, feePct);
    return {
      ebayList: lists.ebay,
      kleinList: lists.kleinanzeigen,
      pocketTarget: pocket,
      feePct,
      compCount: 0,
      fromSnapshot: false,
    };
  }

  return null;
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
