/**
 * Listing watchlist helpers: Ready / already-linked items get delisting + price hints.
 * Presence matching runs against all eligible in-stock items.
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

function gapSignificant(live: number, suggest: number): boolean {
  if (!(live > 0) || !(suggest > 0)) return false;
  const delta = Math.abs(live - suggest);
  if (delta < PRICE_HINT_MIN_EUR) return false;
  return delta / suggest >= PRICE_HINT_MIN_PCT;
}

/** Cheap suggest pair without comps / sales-pool scans (safe for filters + row paint). */
function cheapSuggestLists(item: InventoryItem): {
  klein: number;
  ebay: number;
  targetMargin: number;
  daysHeld: number;
} | null {
  const daysHeld = daysHeldFromBuyDate(item.buyDate);
  const targetMargin = targetMarginForDaysHeld(daysHeld);
  const storedKlein = Number(item.suggestedKleinListPrice) || 0;
  const storedEbay = Number(item.suggestedEbayListPrice) || 0;
  if (storedKlein > 0 && storedEbay > 0) {
    return { klein: storedKlein, ebay: storedEbay, targetMargin, daysHeld };
  }
  const buy = Number(item.buyPrice) || 0;
  if (!(buy > 0)) return null;
  const pocket = roundMoney(buy * (1 + targetMargin));
  const feePct = totalEbayFeePct(loadFlipFees());
  const lists = listPricesForPocket(pocket, feePct);
  return {
    klein: lists.kleinanzeigen,
    ebay: lists.ebay,
    targetMargin,
    daysHeld,
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

  let klein: number;
  let ebay: number;
  let targetPct: number;

  if (suggestion && suggestion.kleinList > 0 && suggestion.ebayList > 0) {
    klein = suggestion.kleinList;
    ebay = suggestion.ebayList;
    targetPct = Math.round(
      (suggestion.targetMargin ??
        targetMarginForDaysHeld(suggestion.daysHeld ?? daysHeldFromBuyDate(item.buyDate))) *
        100
    );
  } else {
    const cheap = cheapSuggestLists(item);
    if (!cheap) return null;
    klein = cheap.klein;
    ebay = cheap.ebay;
    targetPct = Math.round(cheap.targetMargin * 100);
  }

  const kaLive = item.listedOnKleinanzeigen ? Number(item.liveKleinListPrice) || 0 : 0;
  const ebLive = item.listedOnEbay ? Number(item.liveEbayListPrice) || 0 : 0;

  const hints: Array<{ channel: 'KA' | 'EB'; live: number; suggest: number }> = [];
  if (kaLive > 0 && gapSignificant(kaLive, klein)) {
    hints.push({ channel: 'KA', live: kaLive, suggest: klein });
  }
  if (ebLive > 0 && gapSignificant(ebLive, ebay)) {
    hints.push({ channel: 'EB', live: ebLive, suggest: ebay });
  }
  if (!hints.length) return null;

  const over = hints.filter((h) => h.live > h.suggest);
  const pick = (over.length ? over : hints).sort(
    (a, b) => Math.abs(b.live - b.suggest) - Math.abs(a.live - a.suggest)
  )[0];

  const deltaEur = Math.round((pick.live - pick.suggest) * 100) / 100;
  const deltaPct = Math.round(((pick.live - pick.suggest) / pick.suggest) * 1000) / 10;
  const action =
    deltaEur > 0
      ? `Lower ${pick.channel} €${Math.round(pick.live)} → €${Math.round(pick.suggest)}`
      : `Raise ${pick.channel} €${Math.round(pick.live)} → €${Math.round(pick.suggest)}`;

  return {
    channel: hints.length > 1 ? 'both' : pick.channel,
    live: pick.live,
    suggest: pick.suggest,
    deltaEur,
    deltaPct,
    label: `${action} · ${targetPct}% target`,
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
