/**
 * Listing watchlist helpers: Ready / already-linked items get delisting + price hints.
 * Presence matching runs against all eligible in-stock items.
 * Price analyzer: age + buy → suggest; live ask → drop / raise.
 */

import type { InventoryItem } from '../types';
import { ItemStatus } from '../types';
import {
  daysHeldFromBuyDate,
  targetMarginForDaysHeld,
  type SuggestedEbayPrice,
} from './flipInsights';
import { listPricesForPocket, loadFlipFees, totalEbayFeePct } from './flipCoach';
import { roundMoney } from '../services/financialAggregation';

/** Absolute € or % gap before we nudge “change price”. */
export const PRICE_HINT_MIN_EUR = 5;
export const PRICE_HINT_MIN_PCT = 0.05;

/** Eligible for listing match (in stock, sellable) — broader than the Ready watchlist. */
export function isListingPresenceEligible(item: InventoryItem): boolean {
  if (item.isDraft || item.isDefective) return false;
  if (
    item.status !== ItemStatus.IN_STOCK &&
    item.status !== ItemStatus.ORDERED
  ) {
    return false;
  }
  if (item.status === ItemStatus.IN_COMPOSITION || item.parentContainerId) {
    return false;
  }
  return true;
}

export function isListingWatchCandidate(item: InventoryItem): boolean {
  if (!isListingPresenceEligible(item)) return false;

  if (item.saleReady) return true;
  if (item.workflowStage === 'Ready' || item.workflowStage === 'Listed') return true;
  if (item.listedOnEbay || item.listedOnKleinanzeigen) return true;
  if (item.ebayListingId || item.kleinanzeigenListingUrl) return true;
  if (item.liveEbayListPrice != null || item.liveKleinListPrice != null) return true;
  return false;
}

export type PriceChangeHint = {
  channel: 'KA' | 'EB' | 'both';
  live: number;
  suggest: number;
  /** Positive = live is higher than suggest (usually: lower the listing). */
  deltaEur: number;
  deltaPct: number;
  label: string;
};

export type PriceAnalyzerAction = 'drop' | 'raise' | 'ok' | 'list';

export type PriceAnalyzerChannel = {
  channel: 'KA' | 'EB';
  suggest: number;
  live?: number;
  action: PriceAnalyzerAction;
  deltaEur: number;
  /** Short chip text, e.g. "DROP €130 → €80" */
  label: string;
};

export type PriceAnalyzer = {
  daysHeld: number;
  targetMarginPct: number;
  buy: number;
  /** "Day 6 · 45% target" */
  ageLabel: string;
  kleinSuggest: number;
  ebaySuggest: number;
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
export function cheapSuggestLists(item: InventoryItem): {
  klein: number;
  ebay: number;
  targetMargin: number;
  daysHeld: number;
  buy: number;
} | null {
  const daysHeld = daysHeldFromBuyDate(item.buyDate);
  const targetMargin = targetMarginForDaysHeld(daysHeld);
  const buy = Number(item.buyPrice) || 0;
  const storedKlein = Number(item.suggestedKleinListPrice) || 0;
  const storedEbay = Number(item.suggestedEbayListPrice) || 0;
  if (storedKlein > 0 && storedEbay > 0) {
    return { klein: storedKlein, ebay: storedEbay, targetMargin, daysHeld, buy };
  }
  if (!(buy > 0)) return null;
  const pocket = roundMoney(buy * (1 + targetMargin));
  const feePct = totalEbayFeePct(loadFlipFees());
  const lists = listPricesForPocket(pocket, feePct);
  return {
    klein: lists.kleinanzeigen,
    ebay: lists.ebay,
    targetMargin,
    daysHeld,
    buy,
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
      label: `List ${channel} €${Math.round(suggest)}`,
    };
  }
  if (!gapSignificant(live, suggest)) {
    return {
      channel,
      suggest,
      live,
      action: 'ok',
      deltaEur: 0,
      label: `OK ${channel} €${Math.round(live)}`,
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
      label: `DROP ${channel} €${Math.round(live)} → €${Math.round(suggest)}`,
    };
  }
  return {
    channel,
    suggest,
    live,
    action: 'raise',
    deltaEur,
    label: `RAISE ${channel} €${Math.round(live)} → €${Math.round(suggest)}`,
  };
}

function actionRank(a: PriceAnalyzerAction): number {
  if (a === 'drop') return 3;
  if (a === 'raise') return 2;
  if (a === 'list') return 1;
  return 0;
}

/**
 * Age + buy → suggested KA/EB; compare to live asks when listed.
 * Cheap enough for every inventory row (no comps scan).
 */
export function computePriceAnalyzer(
  item: InventoryItem,
  suggestion?: SuggestedEbayPrice | null
): PriceAnalyzer | null {
  if (!isListingPresenceEligible(item)) return null;

  let klein: number;
  let ebay: number;
  let targetMargin: number;
  let daysHeld: number;
  let buy: number;

  if (suggestion && suggestion.kleinList > 0 && suggestion.ebayList > 0) {
    klein = suggestion.kleinList;
    ebay = suggestion.ebayList;
    daysHeld = suggestion.daysHeld ?? daysHeldFromBuyDate(item.buyDate);
    targetMargin =
      suggestion.targetMargin ?? targetMarginForDaysHeld(daysHeld);
    buy = Number(item.buyPrice) || 0;
  } else {
    const cheap = cheapSuggestLists(item);
    if (!cheap) return null;
    klein = cheap.klein;
    ebay = cheap.ebay;
    targetMargin = cheap.targetMargin;
    daysHeld = cheap.daysHeld;
    buy = cheap.buy;
  }

  const targetMarginPct = Math.round(targetMargin * 100);
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

  return {
    daysHeld,
    targetMarginPct,
    buy,
    ageLabel: `Day ${daysHeld} · ${targetMarginPct}% target`,
    kleinSuggest: klein,
    ebaySuggest: ebay,
    channels,
    primary,
  };
}

/**
 * Compare live marketplace ask vs suggest.
 * Pass `suggestion` from the inventory chip map when available; never runs full comps.
 */
export function computePriceChangeHint(
  item: InventoryItem,
  suggestion?: SuggestedEbayPrice | null
): PriceChangeHint | null {
  if (!isListingWatchCandidate(item)) return null;
  const analyzer = computePriceAnalyzer(item, suggestion);
  if (!analyzer) return null;
  const moves = analyzer.channels.filter(
    (c) => c.action === 'drop' || c.action === 'raise'
  );
  if (!moves.length) return null;

  const over = moves.filter((h) => h.action === 'drop');
  const pick = (over.length ? over : moves).sort(
    (a, b) => Math.abs(b.deltaEur) - Math.abs(a.deltaEur)
  )[0];

  const deltaEur = pick.deltaEur;
  const deltaPct =
    pick.suggest > 0
      ? Math.round((deltaEur / pick.suggest) * 1000) / 10
      : 0;

  return {
    channel: moves.length > 1 ? 'both' : pick.channel,
    live: pick.live || 0,
    suggest: pick.suggest,
    deltaEur,
    deltaPct,
    label: `${pick.label} · ${analyzer.targetMarginPct}% target`,
  };
}

/** Filter-friendly: true if live vs stored/age suggest looks off — no comps. */
export function hasPriceChangeHintFast(item: InventoryItem): boolean {
  return computePriceChangeHint(item) != null;
}

export function isSaleReadyUnlisted(item: InventoryItem): boolean {
  if (!item.saleReady && item.workflowStage !== 'Ready') return false;
  if (item.isDefective || item.isDraft) return false;
  if (item.status !== ItemStatus.IN_STOCK && item.status !== ItemStatus.ORDERED) return false;
  if (item.parentContainerId) return false;
  return !item.listedOnEbay && !item.listedOnKleinanzeigen;
}

export function isMaybeSoldCandidate(item: InventoryItem): boolean {
  if (item.isDefective || item.isDraft) return false;
  if (item.status !== ItemStatus.IN_STOCK && item.status !== ItemStatus.ORDERED) return false;
  if (item.maybeSoldDismissedAt) return false;
  return Boolean(item.maybeSoldHint);
}

export function isSaleReadyWatch(item: InventoryItem): boolean {
  if (item.isDefective || item.isDraft) return false;
  if (item.status !== ItemStatus.IN_STOCK && item.status !== ItemStatus.ORDERED) return false;
  if (item.parentContainerId) return false;
  return Boolean(item.saleReady || item.workflowStage === 'Ready' || item.workflowStage === 'Listed');
}

export function maybeSoldLabel(hint?: InventoryItem['maybeSoldHint']): string {
  if (hint === 'ebay') return 'Gone from eBay — mark sold?';
  if (hint === 'kleinanzeigen') return 'Gone from KA — mark sold?';
  if (hint === 'both') return 'Gone from KA + eBay — mark sold?';
  return '';
}
