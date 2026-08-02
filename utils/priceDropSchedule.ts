/**
 * Price Drop Scheduler — every 3 days, markdown live KA/eBay list prices toward a
 * 30% pocket floor (Flip Coach MIN_SUGGEST_MARGIN). Claude applies via Chrome; no APIs.
 */
import type { InventoryItem } from '../types';
import { ItemStatus } from '../types';
import { roundMoney } from '../services/financialAggregation';
import {
  listPricesForPocket,
  loadFlipFees,
  totalEbayFeePct,
  type FlipFeeSettings,
} from './flipCoach';
import { MIN_SUGGEST_MARGIN } from './flipInsights';
import { scoreListingTitleMatch, normalizeListingText } from './ebayListingMatch';
import { scoreKaTitleMatch } from './listingPresence';

export const PRICE_DROP_STORAGE_KEY = 'deinv_price_drop_plan_v1';
export const DEFAULT_DROP_PCT = 0.05;
/** Hard cap — never markdown more than this in one cycle (catastrophic typo guard). */
export const MAX_DROP_PCT_PER_CYCLE = 0.08;
export const PRICE_DROP_CYCLE_DAYS = 3;
export const FLOOR_MARGIN = MIN_SUGGEST_MARGIN; // 0.30
/**
 * Absolute emergency: list (KA) / pocket-backed list must never fall below buy × this
 * (on top of the 30% pocket floor). Blocks €100→€5 disasters if floor math fails.
 */
export const ABSOLUTE_MIN_LIST_VS_BUY = 1.0;
/** If live page price vs JSON currentPrice differs by more than this → wrong listing. */
export const MAX_LIVE_DRIFT_PCT = 0.2;
/** Abort save if typed value drifts from nextPrice by more than this fraction. */
export const MAX_TYPE_ERROR_PCT = 0.05;

export type PriceDropChannel = 'ebay' | 'kleinanzeigen';
export type MatchConfidence = 'high' | 'medium' | 'low';
export type PriceDropRowStatus = 'ready' | 'at_floor' | 'unmatched' | 'applied';

export type PriceDropRow = {
  itemId: string;
  inventoryName: string;
  channel: PriceDropChannel;
  listingIdOrUrl: string | null;
  matchedTitle: string | null;
  matchScore: number;
  matchConfidence: MatchConfidence;
  currentPrice: number | null;
  nextPrice: number | null;
  floorPrice: number;
  dropPctApplied: number;
  status: PriceDropRowStatus;
  appliedAt?: string;
  buyPrice: number;
  currency: 'EUR';
  kaWholeEurosOnly: boolean;
};

export type PriceDropPlan = {
  generatedAt: string;
  nextDueAt: string;
  dropPct: number;
  feePct: number;
  rows: PriceDropRow[];
};

/** Flatten “2x8GB” / “2 x 8 gb” into equivalent total GB tokens for fuzzy compare. */
export function expandRamCapacityTokens(text: string): string {
  let t = normalizeListingText(text);
  // 2x8gb / 2 x 8 gb → 16gb
  t = t.replace(/\b(\d+)\s*[x×]\s*(\d+)\s*(gb|g)\b/gi, (_m, a, b, unit) => {
    const total = Number(a) * Number(b);
    return Number.isFinite(total) ? `${total}${unit === 'g' ? 'gb' : unit}` : _m;
  });
  // strip bare MHz / MT/s when comparing (speed often missing on one side)
  t = t.replace(/\b\d{3,5}\s*(mhz|mt\/?s|mts)\b/gi, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

export function priceDropNameSimilarity(a: string, b: string): number {
  const na = expandRamCapacityTokens(a);
  const nb = expandRamCapacityTokens(b);
  if (!na || !nb) return 0;
  const ebay = scoreListingTitleMatch(na, nb);
  const ka = scoreKaTitleMatch(na, nb);
  // Blend 0–1-ish: ebay raw often 0–200+, ka 0–1
  const ebayNorm = Math.min(1, ebay / 180);
  return Math.max(ebayNorm, ka);
}

export function floorPocket(buyPrice: number, margin = FLOOR_MARGIN): number {
  const buy = Number(buyPrice) || 0;
  if (buy <= 0) return 0;
  return roundMoney(buy * (1 + margin));
}

/** KA floor — whole euros only, never below pocket floor. */
export function floorKa(buyPrice: number, margin = FLOOR_MARGIN): number {
  return Math.ceil(floorPocket(buyPrice, margin));
}

/** eBay list floor so pocket after fees ≥ floorPocket. */
export function floorEbay(
  buyPrice: number,
  ebayTotalFeePct: number,
  margin = FLOOR_MARGIN,
): number {
  const pocket = floorPocket(buyPrice, margin);
  if (pocket <= 0) return 0;
  const list = listPricesForPocket(pocket, ebayTotalFeePct).ebay;
  return Math.ceil(list);
}

/** Clamp configured drop to the hard per-cycle cap. */
export function sanitizeDropPct(dropPct: number): number {
  const d = Number(dropPct);
  if (!Number.isFinite(d) || d <= 0) return DEFAULT_DROP_PCT;
  return Math.min(MAX_DROP_PCT_PER_CYCLE, Math.max(0.01, d));
}

/**
 * Absolute list floor: never below buy×ABSOLUTE_MIN_LIST_VS_BUY, and never below
 * channel fee-aware 30% pocket floor.
 */
export function absoluteMinListPrice(
  buyPrice: number,
  channel: PriceDropChannel,
  ebayTotalFeePct: number,
  margin = FLOOR_MARGIN,
): number {
  const buy = Number(buyPrice) || 0;
  const byBuy = buy > 0 ? roundMoney(buy * ABSOLUTE_MIN_LIST_VS_BUY) : 0;
  const byMargin = channel === 'ebay' ? floorEbay(buy, ebayTotalFeePct, margin) : floorKa(buy, margin);
  const hard = Math.max(byBuy, byMargin);
  return channel === 'kleinanzeigen' ? Math.ceil(hard) : Math.ceil(hard * 100) / 100;
}

export type PriceSafetyVerdict = {
  ok: boolean;
  reason?: string;
  safeNext: number | null;
};

/**
 * Final gate before export / apply: next must stay near current and above floors.
 * Rejects €100→€5 style disasters even if a caller passes a bad next.
 */
export function validatePriceTransition(params: {
  buyPrice: number;
  currentPrice: number;
  nextPrice: number;
  floorPrice: number;
  channel: PriceDropChannel;
  feePct: number;
  dropPct?: number;
}): PriceSafetyVerdict {
  const { buyPrice, currentPrice, channel, feePct } = params;
  const dropPct = sanitizeDropPct(params.dropPct ?? DEFAULT_DROP_PCT);
  const current = Number(currentPrice);
  const next = Number(params.nextPrice);
  const floor = Math.max(
    Number(params.floorPrice) || 0,
    absoluteMinListPrice(buyPrice, channel, feePct),
  );

  if (!(current > 0) || !(next > 0)) {
    return { ok: false, reason: 'missing_price', safeNext: null };
  }
  if (next > current) {
    return { ok: false, reason: 'would_raise', safeNext: null };
  }
  if (next < floor) {
    return { ok: false, reason: 'below_floor', safeNext: null };
  }
  // Reject if next is more than MAX_DROP_PCT_PER_CYCLE below current (typo / wrong field)
  const minByCap =
    channel === 'kleinanzeigen'
      ? Math.max(floor, Math.round(current * (1 - MAX_DROP_PCT_PER_CYCLE)))
      : Math.max(floor, roundMoney(current * (1 - MAX_DROP_PCT_PER_CYCLE)));
  if (next + 0.009 < minByCap) {
    return { ok: false, reason: 'drop_too_steep', safeNext: null };
  }
  // Also reject if steeper than this cycle's sanitized dropPct
  const minByStep =
    channel === 'kleinanzeigen'
      ? Math.max(floor, Math.round(current * (1 - dropPct)))
      : Math.max(floor, roundMoney(current * (1 - dropPct)));
  if (next + 0.009 < minByStep) {
    return { ok: false, reason: 'steeper_than_plan', safeNext: null };
  }
  // Catastrophe: list under buy (KA) or pocket under buy (eBay)
  if (channel === 'kleinanzeigen' && buyPrice > 0 && next < buyPrice * ABSOLUTE_MIN_LIST_VS_BUY) {
    return { ok: false, reason: 'below_buy', safeNext: null };
  }
  if (channel === 'ebay' && buyPrice > 0) {
    const pocket = roundMoney(next * (1 - Math.min(0.85, feePct / 100)));
    if (pocket < buyPrice * ABSOLUTE_MIN_LIST_VS_BUY) {
      return { ok: false, reason: 'ebay_pocket_below_buy', safeNext: null };
    }
  }
  // Never allow next < 50% of current (would require multi-cycle; single typo guard)
  if (next < current * 0.5) {
    return { ok: false, reason: 'catastrophic_vs_current', safeNext: null };
  }

  return { ok: true, safeNext: next };
}

/** Next KA price: −dropPct, whole euros, never below floor. */
export function nextKaPrice(current: number, floor: number, dropPct = DEFAULT_DROP_PCT): number {
  const pct = sanitizeDropPct(dropPct);
  if (!(current > 0)) return floor;
  if (current <= floor) return current;
  const raw = current * (1 - pct);
  return Math.max(floor, Math.round(raw));
}

/** Next eBay price: −dropPct (cents OK), never below floor. */
export function nextEbayPrice(current: number, floor: number, dropPct = DEFAULT_DROP_PCT): number {
  const pct = sanitizeDropPct(dropPct);
  if (!(current > 0)) return floor;
  if (current <= floor) return current;
  return Math.max(floor, roundMoney(current * (1 - pct)));
}

function resolveCurrentEbay(item: InventoryItem): number | null {
  const live = Number(item.liveEbayListPrice);
  if (live > 0) return roundMoney(live);
  const sug = Number(item.suggestedEbayListPrice);
  if (sug > 0) return roundMoney(sug);
  const sell = Number(item.sellPrice);
  if (sell > 0) return roundMoney(sell);
  return null;
}

function resolveCurrentKa(item: InventoryItem): number | null {
  const live = Number(item.liveKleinListPrice);
  if (live > 0) return Math.round(live);
  const sug = Number(item.suggestedKleinListPrice);
  if (sug > 0) return Math.round(sug);
  const sell = Number(item.sellPrice);
  if (sell > 0) return Math.round(sell);
  return null;
}

function ebayListingRef(item: InventoryItem): string | null {
  if (item.ebayListingId?.trim()) return item.ebayListingId.trim();
  if (item.ebayOfferId?.trim()) return item.ebayOfferId.trim();
  return null;
}

function kaListingRef(item: InventoryItem): string | null {
  const url = item.kleinanzeigenListingUrl?.trim();
  return url || null;
}

function hasEbaySignal(item: InventoryItem): boolean {
  return Boolean(
    item.listedOnEbay ||
      ebayListingRef(item) ||
      (Number(item.liveEbayListPrice) > 0),
  );
}

function hasKaSignal(item: InventoryItem): boolean {
  return Boolean(
    item.listedOnKleinanzeigen ||
      kaListingRef(item) ||
      (Number(item.liveKleinListPrice) > 0),
  );
}

/**
 * high = linked id/url; medium = listed/live without id; low = weak/no link.
 * Optional titleHint boosts score when comparing inventory name ↔ marketplace title.
 */
export function matchConfidenceForChannel(
  item: InventoryItem,
  channel: PriceDropChannel,
  titleHint?: string,
): { confidence: MatchConfidence; score: number; matchedTitle: string | null } {
  const ref = channel === 'ebay' ? ebayListingRef(item) : kaListingRef(item);
  const listed =
    channel === 'ebay' ? hasEbaySignal(item) : hasKaSignal(item);
  let score = 0;
  let matchedTitle: string | null = null;

  if (titleHint?.trim()) {
    score =
      channel === 'ebay'
        ? scoreListingTitleMatch(expandRamCapacityTokens(item.name), expandRamCapacityTokens(titleHint))
        : scoreKaTitleMatch(expandRamCapacityTokens(item.name), expandRamCapacityTokens(titleHint));
    matchedTitle = titleHint.trim();
  }

  if (ref) {
    return {
      confidence: 'high',
      score: Math.max(score, channel === 'ebay' ? 200 : 0.9),
      matchedTitle: matchedTitle || item.name,
    };
  }
  if (listed) {
    const ok =
      channel === 'ebay'
        ? score >= 80 || !titleHint
        : score >= 0.45 || !titleHint;
    return {
      confidence: ok ? 'medium' : 'low',
      score: titleHint ? score : channel === 'ebay' ? 90 : 0.55,
      matchedTitle: matchedTitle || item.name,
    };
  }
  return { confidence: 'low', score, matchedTitle: matchedTitle };
}

function buildChannelRow(
  item: InventoryItem,
  channel: PriceDropChannel,
  feePct: number,
  dropPct: number,
): PriceDropRow {
  const buy = Number(item.buyPrice) || 0;
  const pct = sanitizeDropPct(dropPct);
  const floor = absoluteMinListPrice(buy, channel, feePct);
  const current = channel === 'ebay' ? resolveCurrentEbay(item) : resolveCurrentKa(item);
  const match = matchConfidenceForChannel(item, channel);
  const ref = channel === 'ebay' ? ebayListingRef(item) : kaListingRef(item);

  if (match.confidence === 'low' && !ref && !(current && current > 0)) {
    return {
      itemId: item.id,
      inventoryName: item.name,
      channel,
      listingIdOrUrl: ref,
      matchedTitle: match.matchedTitle,
      matchScore: match.score,
      matchConfidence: 'low',
      currentPrice: current,
      nextPrice: null,
      floorPrice: floor,
      dropPctApplied: pct,
      status: 'unmatched',
      buyPrice: buy,
      currency: 'EUR',
      kaWholeEurosOnly: channel === 'kleinanzeigen',
    };
  }

  if (current == null || !(current > 0)) {
    return {
      itemId: item.id,
      inventoryName: item.name,
      channel,
      listingIdOrUrl: ref,
      matchedTitle: match.matchedTitle,
      matchScore: match.score,
      matchConfidence: match.confidence,
      currentPrice: null,
      nextPrice: null,
      floorPrice: floor,
      dropPctApplied: pct,
      status: 'unmatched',
      buyPrice: buy,
      currency: 'EUR',
      kaWholeEurosOnly: channel === 'kleinanzeigen',
    };
  }

  if (current <= floor) {
    return {
      itemId: item.id,
      inventoryName: item.name,
      channel,
      listingIdOrUrl: ref,
      matchedTitle: match.matchedTitle,
      matchScore: match.score,
      matchConfidence: match.confidence === 'low' ? 'medium' : match.confidence,
      currentPrice: current,
      nextPrice: current,
      floorPrice: floor,
      dropPctApplied: pct,
      status: 'at_floor',
      buyPrice: buy,
      currency: 'EUR',
      kaWholeEurosOnly: channel === 'kleinanzeigen',
    };
  }

  const next =
    channel === 'ebay'
      ? nextEbayPrice(current, floor, pct)
      : nextKaPrice(current, floor, pct);

  const safety = validatePriceTransition({
    buyPrice: buy,
    currentPrice: current,
    nextPrice: next,
    floorPrice: floor,
    channel,
    feePct,
    dropPct: pct,
  });

  if (!safety.ok || safety.safeNext == null || !(safety.safeNext < current)) {
    return {
      itemId: item.id,
      inventoryName: item.name,
      channel,
      listingIdOrUrl: ref,
      matchedTitle: match.matchedTitle,
      matchScore: match.score,
      matchConfidence: match.confidence === 'low' ? 'medium' : match.confidence,
      currentPrice: current,
      nextPrice: current,
      floorPrice: floor,
      dropPctApplied: pct,
      status: 'at_floor',
      buyPrice: buy,
      currency: 'EUR',
      kaWholeEurosOnly: channel === 'kleinanzeigen',
    };
  }

  const status: PriceDropRowStatus =
    match.confidence === 'low' ? 'unmatched' : 'ready';

  return {
    itemId: item.id,
    inventoryName: item.name,
    channel,
    listingIdOrUrl: ref,
    matchedTitle: match.matchedTitle,
    matchScore: match.score,
    matchConfidence: match.confidence === 'low' && status === 'ready' ? 'medium' : match.confidence,
    currentPrice: current,
    nextPrice: safety.safeNext,
    floorPrice: floor,
    dropPctApplied: pct,
    status,
    buyPrice: buy,
    currency: 'EUR',
    kaWholeEurosOnly: channel === 'kleinanzeigen',
  };
}

export function isPriceDropEligible(item: InventoryItem): boolean {
  if (item.status !== ItemStatus.IN_STOCK) return false;
  return hasEbaySignal(item) || hasKaSignal(item);
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso);
  d.setTime(d.getTime() + days * 86400000);
  return d.toISOString();
}

export function isPlanDue(plan: PriceDropPlan | null, now = Date.now()): boolean {
  if (!plan?.generatedAt) return true;
  const due = new Date(plan.nextDueAt).getTime();
  return !Number.isFinite(due) || now >= due;
}

/** Preserve appliedAt when regenerating the same item+channel still at same next. */
export function mergeAppliedFromPrevious(
  nextRows: PriceDropRow[],
  prev: PriceDropPlan | null,
): PriceDropRow[] {
  if (!prev?.rows?.length) return nextRows;
  const map = new Map(prev.rows.map((r) => [`${r.itemId}:${r.channel}`, r]));
  return nextRows.map((row) => {
    const old = map.get(`${row.itemId}:${row.channel}`);
    if (!old?.appliedAt) return row;
    if (
      old.status === 'applied' &&
      old.nextPrice === row.nextPrice &&
      old.currentPrice === row.currentPrice
    ) {
      return { ...row, status: 'applied', appliedAt: old.appliedAt };
    }
    return row;
  });
}

export function buildPriceDropPlan(
  items: InventoryItem[],
  fees?: FlipFeeSettings,
  opts?: { dropPct?: number; now?: Date; previous?: PriceDropPlan | null },
): PriceDropPlan {
  const feeSettings = fees ?? loadFlipFees();
  const feePct = totalEbayFeePct(feeSettings);
  const dropPct = sanitizeDropPct(opts?.dropPct ?? DEFAULT_DROP_PCT);
  const now = opts?.now ?? new Date();
  const generatedAt = now.toISOString();
  const nextDueAt = addDaysIso(generatedAt, PRICE_DROP_CYCLE_DAYS);

  const rows: PriceDropRow[] = [];
  for (const item of items) {
    if (!isPriceDropEligible(item)) continue;
    if (hasEbaySignal(item)) {
      rows.push(buildChannelRow(item, 'ebay', feePct, dropPct));
    }
    if (hasKaSignal(item)) {
      rows.push(buildChannelRow(item, 'kleinanzeigen', feePct, dropPct));
    }
  }

  rows.sort((a, b) => {
    const order = { ready: 0, unmatched: 1, at_floor: 2, applied: 3 };
    return (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.inventoryName.localeCompare(b.inventoryName);
  });

  return {
    generatedAt,
    nextDueAt,
    dropPct,
    feePct,
    rows: mergeAppliedFromPrevious(rows, opts?.previous ?? null),
  };
}

export function loadPriceDropPlan(): PriceDropPlan | null {
  try {
    const raw = localStorage.getItem(PRICE_DROP_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PriceDropPlan;
    if (!parsed?.generatedAt || !Array.isArray(parsed.rows)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function savePriceDropPlan(plan: PriceDropPlan): void {
  localStorage.setItem(PRICE_DROP_STORAGE_KEY, JSON.stringify(plan));
}

export function markRowsApplied(
  plan: PriceDropPlan,
  keys: Array<{ itemId: string; channel: PriceDropChannel }>,
  at = new Date().toISOString(),
): PriceDropPlan {
  const set = new Set(keys.map((k) => `${k.itemId}:${k.channel}`));
  return {
    ...plan,
    rows: plan.rows.map((r) =>
      set.has(`${r.itemId}:${r.channel}`)
        ? { ...r, status: 'applied' as const, appliedAt: at }
        : r,
    ),
  };
}

/** Export rows Claude should process — double-filtered through validatePriceTransition. */
export function exportAgentPayload(plan: PriceDropPlan): {
  generatedAt: string;
  nextDueAt: string;
  dropPct: number;
  feePct: number;
  safety: {
    floorMargin: number;
    maxDropPctPerCycle: number;
    absoluteMinListVsBuy: number;
    maxLiveDriftPct: number;
    maxTypeErrorPct: number;
    rule: string;
  };
  rows: Array<{
    itemId: string;
    inventoryName: string;
    channel: PriceDropChannel;
    listingIdOrUrl: string | null;
    matchedTitle: string | null;
    matchConfidence: MatchConfidence;
    buyPrice: number;
    currentPrice: number;
    nextPrice: number;
    floorPrice: number;
    minAllowedPrice: number;
    maxAllowedPrice: number;
    currency: 'EUR';
    kaWholeEurosOnly: boolean;
  }>;
} {
  const rows = plan.rows
    .filter((r) => {
      if (!(r.matchConfidence === 'high' || r.matchConfidence === 'medium')) return false;
      if (r.status !== 'ready') return false;
      if (r.currentPrice == null || r.nextPrice == null) return false;
      if (!(r.nextPrice < r.currentPrice)) return false;
      return validatePriceTransition({
        buyPrice: r.buyPrice,
        currentPrice: r.currentPrice,
        nextPrice: r.nextPrice,
        floorPrice: r.floorPrice,
        channel: r.channel,
        feePct: plan.feePct,
        dropPct: plan.dropPct,
      }).ok;
    })
    .map((r) => {
      const minAllowed = Math.max(
        r.floorPrice,
        absoluteMinListPrice(r.buyPrice, r.channel, plan.feePct),
      );
      return {
        itemId: r.itemId,
        inventoryName: r.inventoryName,
        channel: r.channel,
        listingIdOrUrl: r.listingIdOrUrl,
        matchedTitle: r.matchedTitle,
        matchConfidence: r.matchConfidence,
        buyPrice: r.buyPrice,
        currentPrice: r.currentPrice!,
        nextPrice: r.nextPrice!,
        floorPrice: r.floorPrice,
        minAllowedPrice: minAllowed,
        maxAllowedPrice: r.currentPrice!,
        currency: 'EUR' as const,
        kaWholeEurosOnly: r.kaWholeEurosOnly,
      };
    });

  return {
    generatedAt: plan.generatedAt,
    nextDueAt: plan.nextDueAt,
    dropPct: plan.dropPct,
    feePct: plan.feePct,
    safety: {
      floorMargin: FLOOR_MARGIN,
      maxDropPctPerCycle: MAX_DROP_PCT_PER_CYCLE,
      absoluteMinListVsBuy: ABSOLUTE_MIN_LIST_VS_BUY,
      maxLiveDriftPct: MAX_LIVE_DRIFT_PCT,
      maxTypeErrorPct: MAX_TYPE_ERROR_PCT,
      rule:
        'NEVER save a price below minAllowedPrice or buyPrice. NEVER drop more than ~8% vs current in one edit. If unsure, SKIP — a missed drop is fine; a €100→€5 typo is a catastrophe.',
    },
    rows,
  };
}

export const CLAUDE_PRICE_DROP_PROMPT = `You are my marketplace price-drop operator for DeInventory (Germany).

PRIORITY ORDER (non-negotiable)
1) NEVER destroy value — a wrong cheap price is a catastrophe (€100 item sold for €5–€10 = disaster).
2) Speed — move fast; do not dawdle.
3) Exact nextPrice from JSON.

DO NOT invent prices. DO NOT use APIs. Use Chrome like a human seller: open editor → change ONLY price → save.

INPUT
1) This prompt
2) JSON plan (generatedAt, nextDueAt, safety, rows[])

SPEED (mandatory)
- Target ≤20–40 seconds per listing end-to-end. Do NOT spend a minute staring or narrating.
- Minimal commentary while working. No step-by-step essays. Act, then one-line log.
- Prefer keyboard: search → open → Tab to price → type → Save/Enter.
- Batch: finish ALL eBay rows, then ALL KA rows. Do not bounce between sites per item.
- If a listing is not found in ≤20 seconds → SKIP immediately (do not hunt for minutes).
- Skip animations/waiting porn: as soon as the price field is ready, type and save.
- Captcha / login / 2FA → STOP and ask me once. Do not retry loops.

CATASTROPHE GUARDS (read before every Save — if any fail, DO NOT SAVE, SKIP)
1. Typed price MUST equal JSON nextPrice exactly (KA: whole euros only). Drift >5% vs nextPrice → abort that row.
2. Typed price MUST be ≥ minAllowedPrice AND ≥ floorPrice AND ≥ buyPrice (from the same row).
3. Typed price MUST be < currentPrice but NOT less than currentPrice × 0.92 (max ~8% drop per cycle). If the field shows something like €5–€15 on a €80–€200 item → ABORT. Clear the field and SKIP.
4. Before Save, read the price field value once. If it looks like a missing digit (e.g. 19 instead of 190, 9 instead of 95) → ABORT.
5. Live price shown on the page must be within ~20% of JSON currentPrice. Larger drift → wrong listing → SKIP.
6. Never clear the price field and leave it empty/zero. Never type buyPrice alone if nextPrice is higher.
7. Prefer SKIP over SAVE when uncertain. Missing a drop costs nothing; a wrong save can lose the whole margin.

RULES
1. If now < nextDueAt → STOP “not due yet” unless I say FORCE.
2. Process ONLY export rows (already filtered). Ignore anything not in JSON.rows.
3. matchConfidence low / unmatched → already excluded; do not add extras.
4. Change price ONLY — never title, description, photos, shipping, end listing.
5. After each successful save: one line “APPLIED itemId channel old→new”.
6. End with short APPLIED[] and SKIPPED[] tables. Tell me to mark Applied in DeInventory Price Drop.

WORKFLOW — eBay.de (fast)
1. Seller hub → Active listings.
2. Search listingIdOrUrl or matchedTitle tokens.
3. Edit → price = nextPrice → Save. Verify once → next row.

WORKFLOW — Kleinanzeigen.de (fast)
1. meine.kleinanzeigen.de → Meine Anzeigen → Aktiv.
2. Open via URL or search.
3. Bearbeiten → Preis = whole-euro nextPrice → Speichern. Verify once → next row.

START
Reply with ONE short line: due check + counts (eBay N / KA M). Then execute immediately — eBay first, then KA. No preamble.
`;
