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
export const PRICE_DROP_CYCLE_DAYS = 3;
export const FLOOR_MARGIN = MIN_SUGGEST_MARGIN; // 0.30

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

/** Next KA price: −dropPct, whole euros, never below floor. */
export function nextKaPrice(current: number, floor: number, dropPct = DEFAULT_DROP_PCT): number {
  if (!(current > 0)) return floor;
  if (current <= floor) return current;
  const raw = current * (1 - dropPct);
  return Math.max(floor, Math.round(raw));
}

/** Next eBay price: −dropPct (cents OK), never below floor. */
export function nextEbayPrice(current: number, floor: number, dropPct = DEFAULT_DROP_PCT): number {
  if (!(current > 0)) return floor;
  if (current <= floor) return current;
  return Math.max(floor, roundMoney(current * (1 - dropPct)));
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
  const floor =
    channel === 'ebay' ? floorEbay(buy, feePct) : floorKa(buy);
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
      dropPctApplied: dropPct,
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
      dropPctApplied: dropPct,
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
      dropPctApplied: dropPct,
      status: 'at_floor',
      buyPrice: buy,
      currency: 'EUR',
      kaWholeEurosOnly: channel === 'kleinanzeigen',
    };
  }

  const next =
    channel === 'ebay'
      ? nextEbayPrice(current, floor, dropPct)
      : nextKaPrice(current, floor, dropPct);

  const status: PriceDropRowStatus =
    match.confidence === 'low'
      ? 'unmatched'
      : next < current
        ? 'ready'
        : 'at_floor';

  return {
    itemId: item.id,
    inventoryName: item.name,
    channel,
    listingIdOrUrl: ref,
    matchedTitle: match.matchedTitle,
    matchScore: match.score,
    matchConfidence: match.confidence === 'low' && status === 'ready' ? 'medium' : match.confidence,
    currentPrice: current,
    nextPrice: next,
    floorPrice: floor,
    dropPctApplied: dropPct,
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
  const dropPct = opts?.dropPct ?? DEFAULT_DROP_PCT;
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

/** Export rows Claude should process. */
export function exportAgentPayload(plan: PriceDropPlan): {
  generatedAt: string;
  nextDueAt: string;
  dropPct: number;
  feePct: number;
  rows: Array<{
    itemId: string;
    inventoryName: string;
    channel: PriceDropChannel;
    listingIdOrUrl: string | null;
    matchedTitle: string | null;
    matchConfidence: MatchConfidence;
    currentPrice: number;
    nextPrice: number;
    floorPrice: number;
    currency: 'EUR';
    kaWholeEurosOnly: boolean;
  }>;
} {
  const rows = plan.rows
    .filter(
      (r) =>
        (r.matchConfidence === 'high' || r.matchConfidence === 'medium') &&
        r.status === 'ready' &&
        r.currentPrice != null &&
        r.nextPrice != null &&
        r.nextPrice < r.currentPrice,
    )
    .map((r) => ({
      itemId: r.itemId,
      inventoryName: r.inventoryName,
      channel: r.channel,
      listingIdOrUrl: r.listingIdOrUrl,
      matchedTitle: r.matchedTitle,
      matchConfidence: r.matchConfidence,
      currentPrice: r.currentPrice!,
      nextPrice: r.nextPrice!,
      floorPrice: r.floorPrice,
      currency: 'EUR' as const,
      kaWholeEurosOnly: r.kaWholeEurosOnly,
    }));

  return {
    generatedAt: plan.generatedAt,
    nextDueAt: plan.nextDueAt,
    dropPct: plan.dropPct,
    feePct: plan.feePct,
    rows,
  };
}

export const CLAUDE_PRICE_DROP_PROMPT = `You are my marketplace price-drop operator for DeInventory (Germany).

GOAL
Every 3 days, lower my active listing prices on ebay.de and kleinanzeigen.de to the EXACT nextPrice values from the Price Drop plan JSON I paste (or download from DeInventory → Panel → Price Drop → Export).

DO NOT invent prices. DO NOT use APIs. Use Chrome like a human seller: open each listing editor, change price, save.

INPUT
I will paste:
1) This prompt
2) The JSON plan (generatedAt, nextDueAt, rows[])

RULES
1. If now < nextDueAt, STOP and say “not due yet” unless I explicitly say FORCE.
2. Process ONLY rows where matchConfidence is "high" or "medium" AND nextPrice < currentPrice.
3. Skip unmatched / low confidence — list them in SKIPPED.
4. Never set a price BELOW floorPrice for that row.
5. Kleinanzeigen: integer euros ONLY (49 not 49.53). If JSON nextPrice has cents, round UP to whole euro, still ≥ floorPrice.
6. eBay: use nextPrice as given (cents OK). After fees ~25%, pocket must stay ≥ floor; if your typed price would break that, use floorPrice instead and note it.
7. Titles in seller UI may differ slightly from inventoryName (e.g. “2x8GB” vs “16GB”, missing RAM MHz). Prefer listingIdOrUrl / matchedTitle. If you cannot confidently find the listing in ≤30s, SKIP — do not guess.
8. Change price only — do not edit title, description, photos, shipping, or end the listing.
9. After each successful save, record: itemId, channel, old→new, timestamp.
10. When finished, output APPLIED[] and SKIPPED[] markdown tables. Tell me to open DeInventory Price Drop and mark those rows Applied (or paste the APPLIED list so I can mark them).

WORKFLOW — eBay.de
1. Open Chrome → ebay.de seller hub / active listings (Verkäufer / Angebote / Active).
2. For each eBay row: search by listingIdOrUrl or matchedTitle tokens.
3. Open Edit → find price field → set nextPrice → Speichern/Save.
4. Confirm the listed price shows the new value.

WORKFLOW — Kleinanzeigen.de
1. Open meine.kleinanzeigen.de → Meine Anzeigen → Aktiv.
2. For each KA row: open the ad via listingIdOrUrl or search matchedTitle.
3. Bearbeiten → Preis = whole euro nextPrice → Fertig/Speichern.
4. Confirm.

SAFETY
- One listing at a time. If captcha/login/2FA appears, STOP and ask me.
- If price field rejects the value, try floorPrice (KA: whole euro). If still fails, SKIP.
- Do not raise prices. Do not touch sold/reserved/ended ads.
- Prefer exact nextPrice from JSON over “about 5%”.

START
Acknowledge the plan’s generatedAt/nextDueAt and how many rows you will process per channel, then begin with eBay, then KA.
`;
