/**
 * Flip Coach: pocket-money pricing for Kleinanzeigen (0% fees) vs eBay,
 * plus “keep buying” focus from sold history.
 *
 * Assumption (your workflow): InventoryItem.sellPrice = actual sold price
 * (item amount the buyer paid, excluding shipping). eBay Verkaufsgebühr + ads
 * live in feeAmount when parsed from order screenshots. Pocket money =
 * sellPrice − feeAmount. Kleinanzeigen feeAmount is usually 0.
 */

import { InventoryItem, ItemStatus, Platform } from '../types';
import {
  getInventorySoldPriceBand,
  nameSimilarity,
  productModelKeys,
  soldCompsModelCompatible,
} from './inventorySoldComps';
import { resolveSalePlatform } from './salePlatform';
import { roundMoney } from '../services/financialAggregation';
import { findPoolComps, getCachedSaleEvents } from './itemSalesPool';

export const FLIP_FEE_STORAGE_KEY = 'flip_coach_fees_v2';

export type FlipFeeSettings = {
  /** eBay selling fee %, e.g. 10 */
  ebayFeePct: number;
  /** Promoted Listings / ads %, e.g. 12.5 */
  ebayAdsPct: number;
};

export const DEFAULT_FLIP_FEES: FlipFeeSettings = {
  /** ~25% total eBay cut by default (fee + ads). */
  ebayFeePct: 12.5,
  ebayAdsPct: 12.5,
};

export function loadFlipFees(): FlipFeeSettings {
  try {
    const raw = localStorage.getItem(FLIP_FEE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_FLIP_FEES };
    const parsed = JSON.parse(raw) as Partial<FlipFeeSettings>;
    return {
      ebayFeePct: clampPct(parsed.ebayFeePct ?? DEFAULT_FLIP_FEES.ebayFeePct),
      ebayAdsPct: clampPct(parsed.ebayAdsPct ?? DEFAULT_FLIP_FEES.ebayAdsPct),
    };
  } catch {
    return { ...DEFAULT_FLIP_FEES };
  }
}

export function saveFlipFees(fees: FlipFeeSettings): void {
  localStorage.setItem(FLIP_FEE_STORAGE_KEY, JSON.stringify(fees));
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(40, Math.max(0, n));
}

export function totalEbayFeePct(fees: FlipFeeSettings): number {
  return clampPct(fees.ebayFeePct + fees.ebayAdsPct);
}

/** Keep this much in your pocket → what to type as the listing price. */
export function listPricesForPocket(pocketEuro: number, ebayTotalFeePct: number): {
  kleinanzeigen: number;
  ebay: number;
  ebayFeePct: number;
} {
  const pocket = Math.max(0, pocketEuro);
  const fee = Math.min(0.85, Math.max(0, ebayTotalFeePct / 100));
  const ebay = fee >= 0.99 ? pocket : pocket / (1 - fee);
  return {
    kleinanzeigen: roundMoney(pocket),
    ebay: roundMoney(ebay),
    ebayFeePct: ebayTotalFeePct,
  };
}

/** Buyer pays this on eBay → what lands in your pocket after fee%. */
export function pocketFromEbayListPrice(listEuro: number, ebayTotalFeePct: number): number {
  const fee = Math.min(0.85, Math.max(0, ebayTotalFeePct / 100));
  return roundMoney(Math.max(0, listEuro) * (1 - fee));
}

export type ChannelPriceSuggestion = {
  /** Target money in your pocket (from your sold history). */
  pocketTarget: number;
  /** List price on Kleinanzeigen (0% fees) — usually = pocket. */
  kleinList: number;
  /** List price on eBay so that after fees you still hit pocketTarget. */
  ebayList: number;
  ebayFeePct: number;
  /** How many sold comps backed this. */
  compCount: number;
  /** Where comps came from. */
  compSource: 'ebay_net' | 'klein' | 'mixed' | 'none';
  low: number;
  high: number;
  median: number;
  note: string;
};

function soldPocket(
  item: InventoryItem
): { pocket: number; platform: Platform | 'unknown' } | null {
  const sell = Number(item.sellPrice) || 0;
  if (sell <= 0) return null;
  // sellPrice = market sold price; feeAmount = platform fees (0 on Klein / older net-as-sell rows).
  const fee = Number(item.feeAmount) || 0;
  const pocket = Math.max(0, sell - fee);
  return { pocket, platform: resolveSalePlatform(item) };
}

/**
 * Pocket target from your own sold items with similar names.
 * Prefers item-sales-pool comps (incl. bundle-attributed parts), then live sold leaves.
 */
export function suggestChannelPrices(
  items: InventoryItem[],
  name: string,
  fees: FlipFeeSettings,
  opts?: { category?: string; subCategory?: string }
): ChannelPriceSuggestion {
  const feePct = totalEbayFeePct(fees);
  const q = name.trim();
  if (q.length < 3) {
    return emptySuggestion(feePct, 'Type a product name to see price ideas.');
  }

  // Prefer attributed part-level pool (standalone + kit splits) — cached, not rebuilt per chip.
  try {
    const poolHits = findPoolComps(getCachedSaleEvents(items), q, opts);
    if (poolHits.length >= 1) {
      const ebayPockets = poolHits
        .filter((x) => x.event.platform === 'ebay.de')
        .map((x) => x.event.pocket);
      const kleinPockets = poolHits
        .filter((x) => x.event.platform === 'kleinanzeigen.de')
        .map((x) => x.event.pocket);
      const allPockets = poolHits.map((x) => x.event.pocket);
      let pockets: number[];
      let source: ChannelPriceSuggestion['compSource'];
      if (ebayPockets.length >= 2) {
        pockets = ebayPockets;
        source = 'ebay_net';
      } else if (kleinPockets.length >= 2) {
        pockets = kleinPockets;
        source = 'klein';
      } else {
        pockets = allPockets;
        source = 'mixed';
      }
      const sorted = [...pockets].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median =
        sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      const lists = listPricesForPocket(median, feePct);
      const attributed = poolHits.some((h) => h.event.source === 'bundle_attribution');
      return {
        pocketTarget: roundMoney(median),
        kleinList: lists.kleinanzeigen,
        ebayList: lists.ebay,
        ebayFeePct: feePct,
        compCount: pockets.length,
        compSource: source,
        low: roundMoney(sorted[0]),
        high: roundMoney(sorted[sorted.length - 1]),
        median: roundMoney(median),
        note: attributed
          ? 'From your part-level sales pool (includes kit-attributed sells).'
          : 'From your item sales pool (standalone part sells).',
      };
    }
  } catch {
    /* pool unavailable — fall through */
  }

  const sold = items.filter(
    (i) =>
      (i.status === ItemStatus.SOLD || i.status === ItemStatus.TRADED) &&
      !i.isPC &&
      !i.isBundle &&
      typeof i.sellPrice === 'number' &&
      (i.sellPrice as number) > 0
  );

  const queryHasModel = productModelKeys(q).length > 0;
  const minSim = queryHasModel ? 0.28 : 0.45;

  const scored = sold
    .map((i) => {
      if (!soldCompsModelCompatible(q, i.name)) {
        return { item: i, sim: 0, pocketInfo: null as ReturnType<typeof soldPocket> };
      }
      let sim = nameSimilarity(q, i.name);
      if (opts?.subCategory && i.subCategory === opts.subCategory) sim += 0.12;
      else if (opts?.category && i.category === opts.category) sim += 0.06;
      if (queryHasModel && sim >= 0.28) sim = Math.max(sim, 0.45);
      const pocketInfo = soldPocket(i);
      return { item: i, sim: Math.min(1, sim), pocketInfo };
    })
    .filter((x) => x.sim >= minSim && x.pocketInfo)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 16);

  if (!scored.length) {
    // Fall back to generic band helper (also pocket-oriented under your workflow).
    const band = getInventorySoldPriceBand(items, q, opts);
    if (!band) {
      return emptySuggestion(
        feePct,
        'No similar sold items yet. After a few sales, suggestions get smarter.'
      );
    }
    const lists = listPricesForPocket(band.median, feePct);
    return {
      pocketTarget: band.median,
      kleinList: lists.kleinanzeigen,
      ebayList: lists.ebay,
      ebayFeePct: feePct,
      compCount: band.count,
      compSource: 'mixed',
      low: band.low,
      high: band.high,
      median: band.median,
      note: 'Based on similar items you already sold (your pocket money).',
    };
  }

  const ebayPockets = scored
    .filter((x) => x.pocketInfo!.platform === 'ebay.de')
    .map((x) => x.pocketInfo!.pocket);
  const kleinPockets = scored
    .filter((x) => x.pocketInfo!.platform === 'kleinanzeigen.de')
    .map((x) => x.pocketInfo!.pocket);
  const allPockets = scored.map((x) => x.pocketInfo!.pocket);

  let pockets: number[];
  let source: ChannelPriceSuggestion['compSource'];
  if (ebayPockets.length >= 2) {
    pockets = ebayPockets;
    source = 'ebay_net';
  } else if (kleinPockets.length >= 2) {
    pockets = kleinPockets;
    source = 'klein';
  } else {
    pockets = allPockets;
    source = 'mixed';
  }

  const sorted = [...pockets].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const low = sorted[0];
  const high = sorted[sorted.length - 1];
  const lists = listPricesForPocket(median, feePct);

  const note =
    source === 'ebay_net'
      ? 'From your eBay sold prices (pocket = sold − fees). Klein list = that pocket; eBay list is higher so fees don’t eat it.'
      : source === 'klein'
        ? 'From your Kleinanzeigen sales (no fees). eBay list is raised so you keep about the same after fees.'
        : 'From your sold history (pocket = sold price minus any recorded fees).';

  return {
    pocketTarget: roundMoney(median),
    kleinList: lists.kleinanzeigen,
    ebayList: lists.ebay,
    ebayFeePct: feePct,
    compCount: pockets.length,
    compSource: source,
    low: roundMoney(low),
    high: roundMoney(high),
    median: roundMoney(median),
    note,
  };
}

function emptySuggestion(feePct: number, note: string): ChannelPriceSuggestion {
  return {
    pocketTarget: 0,
    kleinList: 0,
    ebayList: 0,
    ebayFeePct: feePct,
    compCount: 0,
    compSource: 'none',
    low: 0,
    high: 0,
    median: 0,
    note,
  };
}

/**
 * Reject comps that sit far above your buy.
 * Cap defaults to buy × 1.6 (60% margin); pass a higher maxMargin when sold history
 * or cheap/split acquisition supports bigger markups (e.g. 100%+).
 */
export function sanitizePocketAgainstBuy(
  pocket: number,
  buy: number,
  compCount: number,
  targetMargin = 0.45,
  maxMargin = 0.6
): { pocket: number; clamped: boolean } {
  if (!(buy > 0) || !(pocket > 0) || compCount <= 0) {
    return { pocket: roundMoney(Math.max(0, pocket)), clamped: false };
  }
  const capMargin = Math.max(0.6, maxMargin);
  const cap = Math.max(buy * (1 + capMargin), buy + 8);
  if (pocket <= cap) return { pocket: roundMoney(pocket), clamped: false };
  const margin = Math.max(0.3, Math.min(capMargin, targetMargin));
  return { pocket: roundMoney(buy * (1 + margin)), clamped: true };
}

export type BuyFocusRow = {
  category: string;
  soldCount: number;
  avgPocketProfit: number;
  avgDaysToSell: number;
  /** € profit per day of capital lock — higher = better to keep buying. */
  profitPerDay: number;
  inStock: number;
  advice: string;
};

/** Categories that sold fast with good pocket profit — keep buying these. */
export function computeBuyFocus(items: InventoryItem[], limit = 8): BuyFocusRow[] {
  const map = new Map<
    string,
    { profits: number[]; days: number[] }
  >();
  const inStockByCat = new Map<string, number>();

  for (const item of items) {
    const cat = item.subCategory || item.category || 'Other';
    if (item.isPC || item.isBundle) continue;

    if (item.status === ItemStatus.IN_STOCK) {
      inStockByCat.set(cat, (inStockByCat.get(cat) || 0) + 1);
      continue;
    }

    if (item.status !== ItemStatus.SOLD && item.status !== ItemStatus.TRADED) continue;
    const pocketInfo = soldPocket(item);
    if (!pocketInfo) continue;
    const buy = Number(item.buyPrice) || 0;
    const profit = pocketInfo.pocket - buy;
    const bucket = map.get(cat) || { profits: [], days: [] };
    bucket.profits.push(profit);
    if (item.buyDate && item.sellDate) {
      const days = Math.max(
        1,
        Math.round(
          (new Date(item.sellDate).getTime() - new Date(item.buyDate).getTime()) / 86400000
        )
      );
      bucket.days.push(days);
    }
    map.set(cat, bucket);
  }

  return Array.from(map.entries())
    .map(([category, b]) => {
      const soldCount = b.profits.length;
      const avgPocketProfit = b.profits.reduce((a, v) => a + v, 0) / soldCount;
      const avgDaysToSell = b.days.length
        ? b.days.reduce((a, v) => a + v, 0) / b.days.length
        : 30;
      const profitPerDay = avgPocketProfit / Math.max(avgDaysToSell, 3);
      const inStock = inStockByCat.get(category) || 0;
      let advice = 'Watch';
      if (avgPocketProfit >= 25 && avgDaysToSell <= 21 && soldCount >= 2) {
        advice = inStock < 2 ? 'Buy more — fast & profitable' : 'Keep buying — proven winner';
      } else if (avgPocketProfit >= 15 && avgDaysToSell <= 35) {
        advice = 'Good focus area';
      } else if (avgDaysToSell > 45) {
        advice = 'Slow — only buy great deals';
      }
      return {
        category,
        soldCount,
        avgPocketProfit: roundMoney(avgPocketProfit),
        avgDaysToSell: Math.round(avgDaysToSell),
        profitPerDay: roundMoney(profitPerDay),
        inStock,
        advice,
      };
    })
    .filter((r) => r.soldCount >= 2 && r.avgPocketProfit > 0)
    .sort((a, b) => b.profitPerDay - a.profitPerDay || b.avgPocketProfit - a.avgPocketProfit)
    .slice(0, limit);
}

export type SellNowRow = {
  item: InventoryItem;
  daysHeld: number;
  pocketTarget: number;
  kleinList: number;
  ebayList: number;
  estimatedPocketProfitKlein: number;
  estimatedPocketProfitEbay: number;
  preferredChannel: 'kleinanzeigen.de' | 'ebay.de' | 'either';
  reason: string;
  compCount: number;
};

/** In-stock items ranked by “sell this soon” with dual-channel prices. */
export function buildSellNowQueue(
  items: InventoryItem[],
  fees: FlipFeeSettings,
  limit = 20
): SellNowRow[] {
  const feePct = totalEbayFeePct(fees);
  const now = Date.now();
  const stock = items.filter(
    (i) =>
      i.status === ItemStatus.IN_STOCK &&
      !i.isPC &&
      !i.isBundle &&
      (i.name || '').trim().length >= 3
  );

  const rows: SellNowRow[] = [];
  for (const item of stock) {
    const suggestion = suggestChannelPrices(items, item.name, fees, {
      category: item.category,
      subCategory: item.subCategory,
    });
    const buy = Number(item.buyPrice) || 0;
    const daysHeld = item.buyDate
      ? Math.max(0, Math.round((now - new Date(item.buyDate).getTime()) / 86400000))
      : 0;
    const ageMargin = Math.max(0.3, Math.min(0.6, 0.6 - 0.05 * Math.floor(daysHeld / 2)));

    // No comps → age-aware markup on buy (60% → 30% over hold time).
    let pocket =
      suggestion.compCount > 0
        ? suggestion.pocketTarget
        : roundMoney(buy > 0 ? buy * (1 + ageMargin) : 0);
    let compCount = suggestion.compCount;
    let note = suggestion.note;

    if (suggestion.compCount > 0) {
      const sane = sanitizePocketAgainstBuy(pocket, buy, suggestion.compCount, ageMargin);
      if (sane.clamped) {
        pocket = roundMoney(buy > 0 ? buy * (1 + ageMargin) : sane.pocket);
        compCount = 0;
        note = 'Sold comps looked unrealistic vs your buy price — using age-based margin instead.';
      } else {
        // Comps below age target → lift to age curve.
        const minPocket = buy > 0 ? buy * (1 + ageMargin) : 0;
        const maxPocket = buy > 0 ? buy * 1.6 : Infinity;
        if (buy > 0 && (pocket < minPocket || pocket > maxPocket)) {
          pocket = roundMoney(buy * (1 + ageMargin));
          compCount = 0;
          note = `Age target ${Math.round(ageMargin * 100)}% margin (day ${daysHeld}) — comps outside band.`;
        }
      }
    }

    const lists =
      compCount > 0
        ? { kleinanzeigen: suggestion.kleinList, ebay: suggestion.ebayList }
        : listPricesForPocket(pocket, feePct);

    const profitKlein = roundMoney(lists.kleinanzeigen - buy);
    const profitEbay = roundMoney(pocketFromEbayListPrice(lists.ebay, feePct) - buy);

    let preferred: SellNowRow['preferredChannel'] = 'either';
    let reason = note;
    if (note.startsWith('Sold comps looked') || note.startsWith('Age target')) {
      reason = note;
      preferred = 'either';
    } else if (profitKlein <= 10 && profitEbay <= 10) {
      reason = 'Thin margin — cut buy cost next time or bundle.';
      preferred = profitKlein >= profitEbay ? 'kleinanzeigen.de' : 'ebay.de';
    } else if (profitEbay < profitKlein - 5) {
      preferred = 'kleinanzeigen.de';
      reason = 'Klein keeps more (no fees). Use eBay only if it won’t sell locally.';
    } else if (daysHeld >= 45) {
      preferred = 'either';
      reason = 'Sitting too long — list on both, drop price if needed.';
    } else if (compCount === 0) {
      reason = `No sold comps — ${Math.round(ageMargin * 100)}% margin target (day ${daysHeld}).`;
    }

    rows.push({
      item,
      daysHeld,
      pocketTarget: pocket,
      kleinList: lists.kleinanzeigen,
      ebayList: lists.ebay,
      estimatedPocketProfitKlein: profitKlein,
      estimatedPocketProfitEbay: profitEbay,
      preferredChannel: preferred,
      reason,
      compCount,
    });
  }

  return rows
    .sort((a, b) => {
      // Stale + profitable first
      const score = (r: SellNowRow) =>
        r.daysHeld * 0.5 + Math.max(r.estimatedPocketProfitKlein, r.estimatedPocketProfitEbay);
      return score(b) - score(a);
    })
    .slice(0, limit);
}

/** Max buy price so that after eBay fees you still hit minPocketProfit. */
export function maxBuyForEbayFlip(
  expectedEbayListPrice: number,
  ebayTotalFeePct: number,
  minPocketProfit: number
): number {
  const pocket = pocketFromEbayListPrice(expectedEbayListPrice, ebayTotalFeePct);
  return roundMoney(Math.max(0, pocket - minPocketProfit));
}

/** Max buy for Kleinanzeigen (no fees). */
export function maxBuyForKleinFlip(expectedKleinList: number, minPocketProfit: number): number {
  return roundMoney(Math.max(0, expectedKleinList - minPocketProfit));
}
