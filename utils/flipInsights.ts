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
import { getCachedSaleEvents, findPoolComps } from './itemSalesPool';
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
  /** Pure margin target used for this suggestion (age floor, may rise with learned sells). */
  targetMargin?: number;
  /** Days held from buyDate when suggestion was computed. */
  daysHeld?: number;
  /** Dynamic ceiling vs buy (default 60%; higher when comps / cheap splits prove it). */
  maxMargin?: number;
  /** Short note for UI/tooltips. */
  marginReason?: string;
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
/**
 * @deprecated Prefer targetMarginForDaysHeld — kept for older call sites / tests.
 * Mid-band fallback when age is unknown.
 */
export const TARGET_SUGGEST_MARGIN = 0.45;
/**
 * Hard ceiling vs buy for “normal” stock. Learned comps / cheap splits may go higher
 * (see ABSOLUTE_MAX_SUGGEST_MARGIN + resolveSuggestionMarginBand).
 */
export const MAX_SUGGEST_MARGIN = 0.6;
/** Absolute ceiling when sold history shows 100%+ margins on cheap/split stock. */
export const ABSOLUTE_MAX_SUGGEST_MARGIN = 2.5;

/**
 * Pure pocket margin vs buy: 60% at day 0, −5 pp every 2 days, floor 30%.
 * day 0–1 → 60%, day 2–3 → 55%, … day 12+ → 30%.
 */
export function targetMarginForDaysHeld(daysHeld: number): number {
  const d = Number.isFinite(daysHeld) ? Math.max(0, Math.floor(daysHeld)) : 0;
  const steps = Math.floor(d / 2);
  const raw = Math.max(MIN_SUGGEST_MARGIN, MAX_SUGGEST_MARGIN - 0.05 * steps);
  return Math.round(raw * 100) / 100;
}

export type SuggestionMarginBand = {
  targetMargin: number;
  maxMargin: number;
  reason?: string;
};

/** Split leftovers / kit children often carry below-market buy costs. */
export function isCheapAcquisitionItem(item: InventoryItem): boolean {
  if (item.id?.startsWith('split-')) return true;
  if (item.parentContainerId) return true;
  return false;
}

function medianOf(nums: number[]): number {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Age floor + learned sold margins + cheap/split buy boost.
 * Kits without sold history stay capped at 60% (avoids fat marketplace comps on €48 bundles).
 */
export function resolveSuggestionMarginBand(
  item: InventoryItem,
  buy: number,
  daysHeld: number,
  allItems?: InventoryItem[]
): SuggestionMarginBand {
  const ageFloor = targetMarginForDaysHeld(daysHeld);
  let targetMargin = ageFloor;
  let maxMargin = MAX_SUGGEST_MARGIN;
  let reason: string | undefined;

  const isKit = Boolean(item.isPC || item.isBundle);
  const cheapAcq = isCheapAcquisitionItem(item) || (buy > 0 && buy < 20 && !isKit);

  if (cheapAcq) {
    // Split / bargain parts routinely clear 100%+ — open the band before comps load.
    targetMargin = Math.max(targetMargin, Math.min(1.0, ageFloor + 0.35));
    maxMargin = Math.max(maxMargin, 1.5);
    reason = 'cheap/split acquisition';
  }

  if (allItems?.length && buy > 0 && !(isKit && !cheapAcq)) {
    try {
      const events = getCachedSaleEvents(allItems);
      const hits = findPoolComps(events, item.name, {
        category: item.category,
        subCategory: item.subCategory,
        limit: 14,
      });
      const margins = hits
        .map((h) => h.event.marginPct / 100)
        .filter(
          (m) =>
            Number.isFinite(m) &&
            m >= MIN_SUGGEST_MARGIN &&
            m <= ABSOLUTE_MAX_SUGGEST_MARGIN
        );
      if (margins.length >= 1) {
        const p50 = medianOf(margins);
        const sorted = [...margins].sort((a, b) => a - b);
        const p75 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75))];
        const buys = hits.map((h) => h.event.buyPrice).filter((b) => b > 0);
        const medianBuy = medianOf(buys);
        const cheaperThanUsual = medianBuy > 0 && buy < medianBuy * 0.65;

        let learnedTarget = Math.max(ageFloor, p50);
        let learnedMax = Math.max(MAX_SUGGEST_MARGIN, p75 * 1.08, learnedTarget + 0.2);

        if (cheaperThanUsual) {
          learnedTarget = Math.min(ABSOLUTE_MAX_SUGGEST_MARGIN, learnedTarget + 0.25);
          learnedMax = Math.min(ABSOLUTE_MAX_SUGGEST_MARGIN, learnedMax + 0.4);
          reason = 'sold comps + cheaper buy than usual';
        } else {
          reason =
            margins.length >= 2
              ? `sold comps (~${Math.round(p50 * 100)}% median margin)`
              : reason || `sold comps (~${Math.round(p50 * 100)}% margin)`;
        }

        targetMargin = Math.max(targetMargin, learnedTarget);
        maxMargin = Math.max(maxMargin, learnedMax);
      }
    } catch {
      /* pool optional */
    }
  }

  // Whole kits without learned comps: keep the old conservative 60% ceiling.
  if (isKit && !reason?.includes('sold comps')) {
    targetMargin = Math.min(Math.max(targetMargin, ageFloor), MAX_SUGGEST_MARGIN);
    maxMargin = MAX_SUGGEST_MARGIN;
    reason = reason?.includes('cheap') ? reason : undefined;
  }

  targetMargin = Math.min(ABSOLUTE_MAX_SUGGEST_MARGIN, Math.max(MIN_SUGGEST_MARGIN, targetMargin));
  maxMargin = Math.min(
    ABSOLUTE_MAX_SUGGEST_MARGIN,
    Math.max(maxMargin, targetMargin, MAX_SUGGEST_MARGIN)
  );

  return {
    targetMargin: Math.round(targetMargin * 100) / 100,
    maxMargin: Math.round(maxMargin * 100) / 100,
    reason,
  };
}

/** Whole days since buyDate (0 if missing/invalid). */
export function daysHeldFromBuyDate(buyDate?: string, now = Date.now()): number {
  if (!buyDate) return 0;
  const t = new Date(buyDate).getTime();
  if (!Number.isFinite(t) || t > now) return 0;
  return Math.max(0, Math.round((now - t) / 86400000));
}

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

function minPocketForBuy(buy: number, margin = MIN_SUGGEST_MARGIN): number {
  return buy > 0 ? roundMoney(buy * (1 + margin)) : 0;
}

function maxPocketForBuy(buy: number, maxMargin = MAX_SUGGEST_MARGIN): number {
  return buy > 0 ? roundMoney(buy * (1 + maxMargin)) : Number.POSITIVE_INFINITY;
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

function costBasedSuggestion(
  buy: number,
  feePct: number,
  targetMargin: number = TARGET_SUGGEST_MARGIN,
  daysHeld = 0,
  maxMargin: number = MAX_SUGGEST_MARGIN,
  marginReason?: string
): SuggestedEbayPrice | null {
  if (!(buy > 0)) return null;
  const ceiling = Math.max(MAX_SUGGEST_MARGIN, maxMargin);
  const margin = Math.max(MIN_SUGGEST_MARGIN, Math.min(ceiling, targetMargin));
  const pocket = roundMoney(buy * (1 + margin));
  const lists = listPricesForPocket(pocket, feePct);
  return withRoundedLists(
    {
      ebayList: lists.ebay,
      kleinList: lists.kleinanzeigen,
      pocketTarget: pocket,
      feePct,
      compCount: 0,
      fromSnapshot: false,
      targetMargin: margin,
      daysHeld,
      maxMargin: ceiling,
      marginReason,
    },
    feePct
  );
}

/**
 * Enforce margin band vs buy: [target … max], never below 30%.
 * Outside band → cost-based at target. Max rises when sold comps / cheap splits prove 100%+.
 */
export function finalizeSuggestionAgainstBuy(
  raw: SuggestedEbayPrice,
  buy: number,
  feePct: number,
  daysHeld = 0,
  band?: SuggestionMarginBand
): SuggestedEbayPrice | null {
  const targetMargin = band?.targetMargin ?? targetMarginForDaysHeld(daysHeld);
  const maxMargin = band?.maxMargin ?? MAX_SUGGEST_MARGIN;
  const marginReason = band?.reason;
  if (!(raw.ebayList > 0) || !(raw.kleinList > 0)) {
    return costBasedSuggestion(buy, feePct, targetMargin, daysHeld, maxMargin, marginReason);
  }

  let pocket = roundMoney(Math.max(0, raw.pocketTarget || raw.kleinList));
  let compCount = raw.compCount;
  const fee = Number.isFinite(raw.feePct) ? raw.feePct : feePct;
  const minPocket = minPocketForBuy(buy, targetMargin);
  const maxPocket = maxPocketForBuy(buy, maxMargin);
  const hardFloor = minPocketForBuy(buy, MIN_SUGGEST_MARGIN);

  if (compCount > 0 && buy > 0) {
    const sane = sanitizePocketAgainstBuy(pocket, buy, compCount, targetMargin, maxMargin);
    if (sane.clamped) {
      return costBasedSuggestion(buy, fee, targetMargin, daysHeld, maxMargin, marginReason);
    }
    pocket = sane.pocket;
  }

  const ebayPocket = pocketFromEbayListPrice(raw.ebayList, fee);
  if (
    buy > 0 &&
    (pocket < minPocket ||
      pocket < hardFloor ||
      pocket > maxPocket ||
      raw.kleinList < minPocket ||
      raw.kleinList > maxPocket ||
      ebayPocket < minPocket)
  ) {
    return costBasedSuggestion(buy, fee, targetMargin, daysHeld, maxMargin, marginReason);
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
        targetMargin,
        daysHeld,
        maxMargin,
        marginReason,
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
      targetMargin,
      daysHeld,
      maxMargin,
      marginReason,
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
  const daysHeld = daysHeldFromBuyDate(item.buyDate);
  const band = resolveSuggestionMarginBand(item, buy, daysHeld, allItems);
  const { targetMargin, maxMargin, reason: marginReason } = band;

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
      fee,
      daysHeld,
      band
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
        feePct,
        daysHeld,
        band
      );
      if (finalized) return finalized;
    }
    return costBasedSuggestion(buy, feePct, targetMargin, daysHeld, maxMargin, marginReason);
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
        feePct,
        daysHeld,
        band
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
        feePct,
        daysHeld,
        band
      );
      if (finalized) return finalized;
    }
  }

  return costBasedSuggestion(buy, feePct, targetMargin, daysHeld, maxMargin, marginReason);
}

/** Build a map of suggested eBay € for in-stock rows (capped for UI performance). */
export function buildSuggestedEbayMap(
  items: InventoryItem[],
  fees: FlipFeeSettings = loadFlipFees(),
  opts?: {
    limit?: number;
    childrenByParent?: Map<string, InventoryItem[]>;
    /** Skip sold-comps (age/cost + saved snapshots only) — use for first paint. */
    snapshotsOnly?: boolean;
  }
): Map<string, SuggestedEbayPrice> {
  const snapshotsOnly = opts?.snapshotsOnly === true;
  if (!snapshotsOnly) {
    getCachedSaleEvents(items);
  }
  const limit = opts?.limit ?? (snapshotsOnly ? 80 : 120);
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
    let s: SuggestedEbayPrice | null;
    if (snapshotsOnly) {
      s = resolveSuggestedFromSnapshotOrCost(item, fees, children);
    } else {
      s = resolveSuggestedEbayList(item, items, fees, children);
    }
    if (!s) continue;
    map.set(item.id, s);
    n += 1;
  }
  return map;
}

/** Cheap suggest for first paint — no comps / sales-pool scans. */
function resolveSuggestedFromSnapshotOrCost(
  item: InventoryItem,
  fees: FlipFeeSettings,
  children: InventoryItem[]
): SuggestedEbayPrice | null {
  const feePct = totalEbayFeePct(fees);
  const buy = effectiveSuggestionBuy(item, children);
  const daysHeld = daysHeldFromBuyDate(item.buyDate);
  const band = resolveSuggestionMarginBand(item, buy, daysHeld);
  const { targetMargin, maxMargin, reason: marginReason } = band;

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
    const klein = roundMoney(
      item.suggestedKleinListPrice || pocket || item.suggestedEbayListPrice
    );
    return finalizeSuggestionAgainstBuy(
      {
        ebayList: roundMoney(item.suggestedEbayListPrice),
        kleinList: klein,
        pocketTarget: pocket,
        feePct: fee,
        compCount: item.suggestedCompCount ?? 0,
        fromSnapshot: true,
      },
      buy,
      fee,
      daysHeld,
      band
    );
  }

  if (children.length) {
    let ebay = 0;
    let klein = 0;
    let pocket = 0;
    let any = false;
    for (const child of children) {
      const s = resolveSuggestedFromSnapshotOrCost(child, fees, []);
      if (!s) continue;
      any = true;
      ebay += s.ebayList;
      klein += s.kleinList;
      pocket += s.pocketTarget;
    }
    if (any) {
      return finalizeSuggestionAgainstBuy(
        {
          ebayList: roundMoney(ebay),
          kleinList: roundMoney(klein),
          pocketTarget: roundMoney(pocket),
          feePct,
          compCount: 0,
          fromSnapshot: false,
        },
        buy,
        feePct,
        daysHeld,
        band
      );
    }
  }

  return costBasedSuggestion(buy, feePct, targetMargin, daysHeld, maxMargin, marginReason);
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
