/**
 * Listing watchlist helpers: Ready / already-linked items get delisting + price hints.
 * Presence matching runs against all eligible in-stock items.
 * Price analyzer: age + buy ÔåÆ suggest; live ask ÔåÆ drop / raise.
 */

import type { InventoryItem } from '../types';
import { ItemStatus } from '../types';
import {
  daysHeldFromBuyDate,
  MIN_SUGGEST_MARGIN,
  resolveSuggestionMarginBand,
  roundListPriceUp,
  type SuggestedEbayPrice,
} from './flipInsights';
import { listPricesForPocket, loadFlipFees, totalEbayFeePct } from './flipCoach';
import { roundMoney } from '../services/financialAggregation';

/** Absolute Ôé¼ or % gap before we nudge ÔÇ£change priceÔÇØ. */
export const PRICE_HINT_MIN_EUR = 5;
export const PRICE_HINT_MIN_PCT = 0.05;

function isPriceAnalyzerEligible(item: InventoryItem): boolean {
  if (item.isDraft || item.isDefective) return false;
  if (
    item.status !== ItemStatus.IN_STOCK &&
    item.status !== ItemStatus.ORDERED
  ) {
    return false;
  }
  if (item.parentContainerId) {
    return false;
  }
  return true;
}

export type PriceAnalyzerAction = 'drop' | 'raise' | 'ok' | 'list';

export type PriceAnalyzerChannel = {
  channel: 'KA' | 'EB';
  suggest: number;
  live?: number;
  action: PriceAnalyzerAction;
  deltaEur: number;
  /** Short chip text, e.g. "DROP Ôé¼130 ÔåÆ Ôé¼80" */
  label: string;
};

export type PriceAnalyzer = {
  daysHeld: number;
  targetMarginPct: number;
  buy: number;
  /** "Day 6 ┬À 45% target" */
  ageLabel: string;
  kleinSuggest: number;
  ebaySuggest: number;
  /** Hard floor: list prices that yield exactly MIN_SUGGEST_MARGIN (30%) pocket vs buy. */
  minMarginPct: number;
  minKlein: number;
  minEbay: number;
  /** "Min 30% ┬À KA Ôé¼63 ┬À EB Ôé¼84" */
  minLabel: string;
  maxMarginPct: number;
  marginReason?: string;
  channels: PriceAnalyzerChannel[];
  /** Most urgent channel (drop/raise preferred over ok/list). */
  primary: PriceAnalyzerChannel | null;
};

function gapSignificant(live: number, suggest: number): boolean {
  if (!(live > 0) || !(suggest > 0)) return false;
  const delta = Math.abs(live - suggest);
  if (delta < PRICE_HINT_MIN_EUR) return false;
  return delta / suggest >= PRICE_HINT_MIN_PCT;
}

/** Cheap suggest pair without comps / sales-pool scans (safe for filters + row paint). */
export function cheapSuggestLists(
  item: InventoryItem,
  allItems?: InventoryItem[]
): {
  klein: number;
  ebay: number;
  targetMargin: number;
  daysHeld: number;
  buy: number;
  maxMargin: number;
  marginReason?: string;
} | null {
  const daysHeld = daysHeldFromBuyDate(item.buyDate);
  const buy = Number(item.buyPrice) || 0;
  const band = resolveSuggestionMarginBand(item, buy, daysHeld, allItems);
  const storedKlein = Number(item.suggestedKleinListPrice) || 0;
  const storedEbay = Number(item.suggestedEbayListPrice) || 0;
  if (storedKlein > 0 && storedEbay > 0) {
    return {
      klein: storedKlein,
      ebay: storedEbay,
      targetMargin: band.targetMargin,
      daysHeld,
      buy,
      maxMargin: band.maxMargin,
      marginReason: band.reason,
    };
  }
  if (!(buy > 0)) return null;
  const pocket = roundMoney(buy * (1 + band.targetMargin));
  const feePct = totalEbayFeePct(loadFlipFees());
  const lists = listPricesForPocket(pocket, feePct);
  return {
    klein: lists.kleinanzeigen,
    ebay: lists.ebay,
    targetMargin: band.targetMargin,
    daysHeld,
    buy,
    maxMargin: band.maxMargin,
    marginReason: band.reason,
  };
}

/** KA + eBay list prices that pocket exactly `margin` on buy (default 30% floor). */
export function minMarginListPrices(
  buy: number,
  margin: number = MIN_SUGGEST_MARGIN
): { klein: number; ebay: number; marginPct: number } | null {
  if (!(buy > 0)) return null;
  const m = Math.max(0, margin);
  const pocket = roundMoney(buy * (1 + m));
  const feePct = totalEbayFeePct(loadFlipFees());
  const lists = listPricesForPocket(pocket, feePct);
  const klein = roundListPriceUp(lists.kleinanzeigen);
  const ebayFromPocket = listPricesForPocket(klein, feePct).ebay;
  const ebay = roundListPriceUp(Math.max(lists.ebay, ebayFromPocket));
  return {
    klein,
    ebay,
    marginPct: Math.round(m * 100),
  };
}

function channelFromLive(
  channel: 'KA' | 'EB',
  suggest: number,
  live: number,
  listed: boolean
): PriceAnalyzerChannel {
  if (!listed || !(live > 0)) {
    return {
      channel,
      suggest,
      action: 'list',
      deltaEur: 0,
      label: `List ${channel} Ôé¼${Math.round(suggest)}`,
    };
  }
  if (!gapSignificant(live, suggest)) {
    return {
      channel,
      suggest,
      live,
      action: 'ok',
      deltaEur: 0,
      label: `OK ${channel} Ôé¼${Math.round(live)}`,
    };
  }
  const deltaEur = roundMoney(live - suggest);
  if (deltaEur > 0) {
    return {
      channel,
      suggest,
      live,
      action: 'drop',
      deltaEur,
      label: `DROP ${channel} Ôé¼${Math.round(live)} ÔåÆ Ôé¼${Math.round(suggest)}`,
    };
  }
  return {
    channel,
    suggest,
    live,
    action: 'raise',
    deltaEur,
    label: `RAISE ${channel} Ôé¼${Math.round(live)} ÔåÆ Ôé¼${Math.round(suggest)}`,
  };
}

function actionRank(a: PriceAnalyzerAction): number {
  if (a === 'drop') return 3;
  if (a === 'raise') return 2;
  if (a === 'list') return 1;
  return 0;
}

/**
 * Age + buy ÔåÆ suggested KA/EB; compare to live asks when listed.
 * Cheap enough for every inventory row (no comps scan).
 */
export function computePriceAnalyzer(
  item: InventoryItem,
  suggestion?: SuggestedEbayPrice | null,
  allItems?: InventoryItem[]
): PriceAnalyzer | null {
  if (!isPriceAnalyzerEligible(item)) return null;

  let klein: number;
  let ebay: number;
  let targetMargin: number;
  let daysHeld: number;
  let buy: number;
  let maxMargin: number;
  let marginReason: string | undefined;

  if (suggestion && suggestion.kleinList > 0 && suggestion.ebayList > 0) {
    klein = suggestion.kleinList;
    ebay = suggestion.ebayList;
    daysHeld = suggestion.daysHeld ?? daysHeldFromBuyDate(item.buyDate);
    buy = Number(item.buyPrice) || 0;
    const band = resolveSuggestionMarginBand(item, buy, daysHeld, allItems);
    targetMargin =
      suggestion.targetMargin ?? band.targetMargin;
    maxMargin = suggestion.maxMargin ?? band.maxMargin;
    marginReason = suggestion.marginReason ?? band.reason;
  } else {
    const cheap = cheapSuggestLists(item, allItems);
    if (!cheap) return null;
    klein = cheap.klein;
    ebay = cheap.ebay;
    targetMargin = cheap.targetMargin;
    daysHeld = cheap.daysHeld;
    buy = cheap.buy;
    maxMargin = cheap.maxMargin;
    marginReason = cheap.marginReason;
  }

  const targetMarginPct = Math.round(targetMargin * 100);
  const maxMarginPct = Math.round(maxMargin * 100);
  const floor = minMarginListPrices(buy > 0 ? buy : Number(item.buyPrice) || 0);
  const minMarginPct = floor?.marginPct ?? Math.round(MIN_SUGGEST_MARGIN * 100);
  const minKlein = floor?.klein ?? 0;
  const minEbay = floor?.ebay ?? 0;
  const kaLive = Number(item.liveKleinListPrice) || 0;
  const ebLive = Number(item.liveEbayListPrice) || 0;
  const channels: PriceAnalyzerChannel[] = [
    channelFromLive('KA', klein, kaLive, Boolean(item.listedOnKleinanzeigen)),
    channelFromLive('EB', ebay, ebLive, Boolean(item.listedOnEbay)),
  ];

  const primary =
    [...channels].sort((a, b) => {
      const rd = actionRank(b.action) - actionRank(a.action);
      if (rd) return rd;
      return Math.abs(b.deltaEur) - Math.abs(a.deltaEur);
    })[0] || null;

  const ageLabel =
    maxMarginPct > targetMarginPct
      ? `Day ${daysHeld} ┬À ${targetMarginPct}% target (cap ${maxMarginPct}%)`
      : `Day ${daysHeld} ┬À ${targetMarginPct}% target`;

  return {
    daysHeld,
    targetMarginPct,
    buy,
    ageLabel,
    kleinSuggest: klein,
    ebaySuggest: ebay,
    minMarginPct,
    minKlein,
    minEbay,
    minLabel:
      minKlein > 0 && minEbay > 0
        ? `Min ${minMarginPct}% ┬À KA Ôé¼${Math.round(minKlein)} ┬À EB Ôé¼${Math.round(minEbay)}`
        : `Min ${minMarginPct}%`,
    maxMarginPct,
    marginReason,
    channels,
    primary,
  };
}
