/**
 * Listing watchlist: only sale-ready / already-linked items get presence + price sync.
 * Keeps defective and unprepared stock out of the parser noise.
 */

import type { InventoryItem } from '../types';
import { ItemStatus } from '../types';
import {
  daysHeldFromBuyDate,
  resolveSuggestedEbayList,
  targetMarginForDaysHeld,
  type SuggestedEbayPrice,
} from './flipInsights';
import { loadFlipFees } from './flipCoach';

/** Absolute € or % gap before we nudge “change price”. */
export const PRICE_HINT_MIN_EUR = 5;
export const PRICE_HINT_MIN_PCT = 0.05;

export function isListingWatchCandidate(item: InventoryItem): boolean {
  if (item.isDraft || item.isDefective) return false;
  if (
    item.status !== ItemStatus.IN_STOCK &&
    item.status !== ItemStatus.ORDERED
  ) {
    return false;
  }
  // Composition parts are tracked via the parent kit listing.
  if (item.status === ItemStatus.IN_COMPOSITION || item.parentContainerId) {
    return false;
  }

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

/**
 * Compare live marketplace ask vs age-aware suggest. Prefer drop hints when live > suggest.
 */
export function computePriceChangeHint(
  item: InventoryItem,
  suggestion?: SuggestedEbayPrice | null
): PriceChangeHint | null {
  if (!isListingWatchCandidate(item)) return null;
  const fees = loadFlipFees();
  const sugg =
    suggestion ||
    resolveSuggestedEbayList(item, [item], fees, []);
  if (!sugg) return null;

  const kaLive = item.listedOnKleinanzeigen ? Number(item.liveKleinListPrice) || 0 : 0;
  const ebLive = item.listedOnEbay ? Number(item.liveEbayListPrice) || 0 : 0;
  const days = sugg.daysHeld ?? daysHeldFromBuyDate(item.buyDate);
  const targetPct = Math.round((sugg.targetMargin ?? targetMarginForDaysHeld(days)) * 100);

  const hints: Array<{ channel: 'KA' | 'EB'; live: number; suggest: number }> = [];
  if (kaLive > 0 && gapSignificant(kaLive, sugg.kleinList)) {
    hints.push({ channel: 'KA', live: kaLive, suggest: sugg.kleinList });
  }
  if (ebLive > 0 && gapSignificant(ebLive, sugg.ebayList)) {
    hints.push({ channel: 'EB', live: ebLive, suggest: sugg.ebayList });
  }
  if (!hints.length) return null;

  // Prefer the channel where live is above suggest (stale high ask).
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

export function isSaleReadyUnlisted(item: InventoryItem): boolean {
  if (!item.saleReady && item.workflowStage !== 'Ready') return false;
  if (item.isDefective || item.isDraft) return false;
  if (item.status !== ItemStatus.IN_STOCK && item.status !== ItemStatus.ORDERED) return false;
  if (item.parentContainerId) return false;
  return !item.listedOnEbay && !item.listedOnKleinanzeigen;
}
