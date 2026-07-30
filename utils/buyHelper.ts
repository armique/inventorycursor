/**
 * Buy Helper (rewrites Sold Pulse): track parts to buy, with editable
 * buy / KA sell / eBay sell / margin, grounded in your sold inventory
 * (including bundle-attributed part prices) and Flip Coach fee settings.
 *
 * Fee model (defaults):
 * - eBay Verkaufsgebühr ~12.5% of list
 * - eBay ads ~12.5% of list
 * - 19% VAT taken from profit after platform fees
 */

import type { InventoryItem } from '../types';
import { roundMoney } from '../services/financialAggregation';
import {
  DEFAULT_FLIP_FEES,
  listPricesForPocket,
  loadFlipFees,
  suggestChannelPrices,
  totalEbayFeePct,
  type FlipFeeSettings,
} from './flipCoach';
import {
  DEFAULT_SOLD_PULSE_PRESETS,
  loadSoldPulseWatchlist,
  type SoldPulseCategory,
  type SoldPulseWatchItem,
} from './ebaySoldPulse';
import {
  findPoolComps,
  getCachedSaleEvents,
  type ItemSaleEvent,
  type PoolCompHit,
} from './itemSalesPool';
import type { ResolvedDealwatchPrices } from '../services/dealwatchPriceSource';
import type { BuyHelperPriceHistory, DealwatchSnapshot } from '../services/buyHelperDealwatchHistory';
import type { DealwatchAnalysis, AnalysisSignal } from '../services/buyHelperDealwatchAnalysis';

export const BUY_HELPER_STORAGE_KEY = 'buy_helper_tracklist_v1';
export const BUY_HELPER_VAT_KEY = 'buy_helper_vat_pct_v1';

// Re-export Dealwatch history and analysis types for convenience
export type { BuyHelperPriceHistory, DealwatchSnapshot } from '../services/buyHelperDealwatchHistory';
export type { DealwatchAnalysis, AnalysisSignal } from '../services/buyHelperDealwatchAnalysis';

export type BuyHelperCategory = SoldPulseCategory;

export type BuyHelperItem = {
  id: string;
  query: string;
  category: BuyHelperCategory;
  note?: string;
  /** Max / target buy price (editable). */
  buyPrice?: number;
  /** Target list price on Kleinanzeigen (editable). */
  sellKa?: number;
  /** Target list price on eBay.de (editable). */
  sellEbay?: number;
  /** Desired net margin % after fees + VAT on profit (editable). */
  desiredMarginPct?: number;
  /** Dealwatch read (inventory comps and/or pasted eBay sold). */
  marketLow?: number;
  marketMedian?: number;
  marketHigh?: number;
  inventoryCompCount?: number;
  lastCheckedAt?: string;
  createdAt: string;
};

export type BuyHelperFees = FlipFeeSettings & {
  /** VAT taken from profit after platform fees (default 19). */
  vatOnProfitPct: number;
};

export const DEFAULT_BUY_HELPER_VAT = 19;
export const DEFAULT_DESIRED_MARGIN_PCT = 35;

export function loadBuyHelperVatPct(): number {
  try {
    const raw = localStorage.getItem(BUY_HELPER_VAT_KEY);
    if (raw == null) return DEFAULT_BUY_HELPER_VAT;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_BUY_HELPER_VAT;
    return Math.min(40, Math.max(0, n));
  } catch {
    return DEFAULT_BUY_HELPER_VAT;
  }
}

export function saveBuyHelperVatPct(pct: number): void {
  const n = Math.min(40, Math.max(0, Number(pct) || 0));
  localStorage.setItem(BUY_HELPER_VAT_KEY, String(n));
}

export function loadBuyHelperFees(): BuyHelperFees {
  const flip = loadFlipFees();
  return {
    ebayFeePct: flip.ebayFeePct ?? DEFAULT_FLIP_FEES.ebayFeePct,
    ebayAdsPct: flip.ebayAdsPct ?? DEFAULT_FLIP_FEES.ebayAdsPct,
    vatOnProfitPct: loadBuyHelperVatPct(),
  };
}

export function pocketFromKaList(listEuro: number): number {
  return roundMoney(Math.max(0, listEuro));
}

export function pocketFromEbayList(listEuro: number, fees: BuyHelperFees): number {
  const fee = Math.min(0.85, Math.max(0, totalEbayFeePct(fees) / 100));
  return roundMoney(Math.max(0, listEuro) * (1 - fee));
}

export type ChannelNetResult = {
  list: number;
  pocket: number;
  grossProfit: number;
  vat: number;
  netProfit: number;
  /** Net profit / buy * 100 */
  marginPct: number;
  /** True when net margin >= desired */
  hitsMargin: boolean;
};

export function channelNet(
  list: number,
  buy: number,
  channel: 'ka' | 'ebay',
  fees: BuyHelperFees,
  desiredMarginPct: number,
): ChannelNetResult {
  const pocket = channel === 'ka' ? pocketFromKaList(list) : pocketFromEbayList(list, fees);
  const gross = roundMoney(pocket - buy);
  const vatRate = Math.min(0.4, Math.max(0, fees.vatOnProfitPct / 100));
  const vat = gross > 0 ? roundMoney(gross * vatRate) : 0;
  const net = roundMoney(gross - vat);
  const marginPct = buy > 0 ? roundMoney((net / buy) * 100) : 0;
  return {
    list: roundMoney(list),
    pocket,
    grossProfit: gross,
    vat,
    netProfit: net,
    marginPct,
    hitsMargin: buy > 0 && marginPct + 1e-6 >= desiredMarginPct,
  };
}

/**
 * Max buy so that after fees + VAT-on-profit you still hit desired net margin %.
 * net = (pocket - buy) * (1 - vat) = buy * (margin/100)
 */
export function maxBuyForNetMargin(
  pocketEuro: number,
  desiredMarginPct: number,
  vatOnProfitPct: number,
): number {
  const pocket = Math.max(0, pocketEuro);
  const k = 1 - Math.min(0.4, Math.max(0, vatOnProfitPct / 100));
  const m = Math.max(0, desiredMarginPct) / 100;
  if (k <= 0) return 0;
  return roundMoney((pocket * k) / (m + k));
}

export type BuyVerdict = 'BUY' | 'WAIT' | 'SKIP';

export type BuyHelperAnalysis = {
  ka: ChannelNetResult | null;
  ebay: ChannelNetResult | null;
  /** Stricter of the two max-buy caps (prefer eBay economics when both set). */
  suggestedMaxBuy: number | null;
  verdict: BuyVerdict;
  verdictReason: string;
  score: number;
};

export function analyzeBuyHelperItem(item: BuyHelperItem, fees: BuyHelperFees): BuyHelperAnalysis {
  const buy = Number(item.buyPrice) || 0;
  const margin = Number(item.desiredMarginPct);
  const desired = Number.isFinite(margin) && margin >= 0 ? margin : DEFAULT_DESIRED_MARGIN_PCT;
  const sellKa = Number(item.sellKa) || 0;
  const sellEbay = Number(item.sellEbay) || 0;

  const ka = sellKa > 0 && buy > 0 ? channelNet(sellKa, buy, 'ka', fees, desired) : null;
  const ebay = sellEbay > 0 && buy > 0 ? channelNet(sellEbay, buy, 'ebay', fees, desired) : null;

  const caps: number[] = [];
  if (sellKa > 0) {
    caps.push(maxBuyForNetMargin(pocketFromKaList(sellKa), desired, fees.vatOnProfitPct));
  }
  if (sellEbay > 0) {
    caps.push(maxBuyForNetMargin(pocketFromEbayList(sellEbay, fees), desired, fees.vatOnProfitPct));
  }
  const suggestedMaxBuy = caps.length ? roundMoney(Math.min(...caps)) : null;

  let verdict: BuyVerdict = 'WAIT';
  let verdictReason = 'Set buy + sell prices to get a verdict.';
  let score = 0;

  if (buy <= 0 || (sellKa <= 0 && sellEbay <= 0)) {
    verdict = 'WAIT';
    verdictReason = 'Fill buy price and at least one sell target.';
  } else if (suggestedMaxBuy != null && buy > suggestedMaxBuy * 1.05) {
    verdict = 'SKIP';
    verdictReason = `Buy €${buy} is above max ~€${suggestedMaxBuy} for ${desired}% net margin after fees/VAT.`;
    score = Math.max(0, 40 - (buy - suggestedMaxBuy));
  } else if ((ka?.hitsMargin || ebay?.hitsMargin) && (suggestedMaxBuy == null || buy <= suggestedMaxBuy * 1.02)) {
    verdict = 'BUY';
    const best = Math.max(ka?.marginPct ?? -Infinity, ebay?.marginPct ?? -Infinity);
    verdictReason = `Hits ≥${desired}% net margin after eBay fees (${totalEbayFeePct(fees)}%) + ${fees.vatOnProfitPct}% VAT on profit.`;
    score = 100 + best;
  } else {
    verdict = 'WAIT';
    const best = Math.max(ka?.marginPct ?? 0, ebay?.marginPct ?? 0);
    verdictReason = `Net margin ~${best}% — below your ${desired}% target. Lower buy or raise sell.`;
    score = best;
  }

  return { ka, ebay, suggestedMaxBuy, verdict, verdictReason, score };
}

export function inventoryCompsForQuery(
  items: InventoryItem[],
  query: string,
  opts?: { category?: string; limit?: number },
): PoolCompHit[] {
  const events = getCachedSaleEvents(items);
  return findPoolComps(events, query, { category: opts?.category, limit: opts?.limit ?? 20 });
}

export function summarizeInventoryComps(hits: PoolCompHit[]): {
  count: number;
  low: number;
  median: number;
  high: number;
  /** Median pocket (after historical fees) — good KA list / eBay pocket target. */
  pocketMedian: number;
  bundleAttributed: number;
  samples: Array<{
    name: string;
    pocket: number;
    allocatedSell: number;
    buyPrice: number;
    platform: string;
    source: ItemSaleEvent['source'];
    soldAt: string;
  }>;
} | null {
  if (!hits.length) return null;
  const pockets = hits.map((h) => h.event.pocket).filter((n) => n > 0).sort((a, b) => a - b);
  if (!pockets.length) return null;
  const mid = Math.floor(pockets.length / 2);
  const median =
    pockets.length % 2 ? pockets[mid] : (pockets[mid - 1] + pockets[mid]) / 2;
  return {
    count: pockets.length,
    low: roundMoney(pockets[0]),
    median: roundMoney(median),
    high: roundMoney(pockets[pockets.length - 1]),
    pocketMedian: roundMoney(median),
    bundleAttributed: hits.filter((h) => h.event.source === 'bundle_attribution').length,
    samples: hits.slice(0, 8).map((h) => ({
      name: h.event.name,
      pocket: h.event.pocket,
      allocatedSell: h.event.allocatedSell,
      buyPrice: h.event.buyPrice,
      platform: String(h.event.platform),
      source: h.event.source,
      soldAt: h.event.soldAt,
    })),
  };
}

/** Fill editable targets from inventory comps + Flip Coach channel math. */
export function suggestBuyHelperTargets(
  items: InventoryItem[],
  query: string,
  fees: BuyHelperFees,
  opts?: { category?: string; desiredMarginPct?: number },
): Partial<BuyHelperItem> & { note?: string } {
  const desired = opts?.desiredMarginPct ?? DEFAULT_DESIRED_MARGIN_PCT;
  const suggestion = suggestChannelPrices(items, query, fees, { category: opts?.category });
  const hits = inventoryCompsForQuery(items, query, { category: opts?.category });
  const inv = summarizeInventoryComps(hits);

  const pocket = inv?.pocketMedian || suggestion.pocketTarget || 0;
  if (pocket <= 0) {
    return {
      desiredMarginPct: desired,
      note: suggestion.note || 'No sold comps yet — set prices manually or paste eBay sold rows.',
      inventoryCompCount: 0,
    };
  }

  const lists = listPricesForPocket(pocket, totalEbayFeePct(fees));
  const maxBuyEbay = maxBuyForNetMargin(pocketFromEbayList(lists.ebay, fees), desired, fees.vatOnProfitPct);
  const maxBuyKa = maxBuyForNetMargin(pocketFromKaList(lists.kleinanzeigen), desired, fees.vatOnProfitPct);
  const buyPrice = roundMoney(Math.min(maxBuyEbay, maxBuyKa));

  const attributed = inv?.bundleAttributed ?? 0;
  const noteParts = [
    inv
      ? `${inv.count} inventory comps${attributed ? ` (${attributed} from sold bundles)` : ''}`
      : suggestion.note,
    `Target ${desired}% net after ${totalEbayFeePct(fees)}% eBay cut + ${fees.vatOnProfitPct}% VAT on profit.`,
  ];

  return {
    buyPrice,
    sellKa: lists.kleinanzeigen,
    sellEbay: lists.ebay,
    desiredMarginPct: desired,
    marketLow: inv?.low ?? suggestion.low,
    marketMedian: inv?.median ?? suggestion.median,
    marketHigh: inv?.high ?? suggestion.high,
    inventoryCompCount: inv?.count ?? suggestion.compCount,
    note: noteParts.filter(Boolean).join(' · '),
    lastCheckedAt: new Date().toISOString(),
  };
}

/**
 * Same as suggestBuyHelperTargets, but grounded in real dealwatch-runtime/ data (eBay sold > eBay live
 * for the eBay channel, KA live for the KA channel — see services/dealwatchPriceSource.ts) when
 * available, falling back to suggestBuyHelperTargets (your own sold inventory) per channel
 * when the Dealwatch bridge has no signal. Reuses channelNet/maxBuyForNetMargin/pocketFromXList
 * as-is — only the sellKa/sellEbay inputs change, never the fee/VAT/margin math itself.
 */
export function suggestBuyHelperTargetsFromDealwatch(
  dealwatchData: ResolvedDealwatchPrices | null,
  items: InventoryItem[],
  query: string,
  fees: BuyHelperFees,
  opts?: { category?: string; desiredMarginPct?: number },
): Partial<BuyHelperItem> & { note?: string } {
  const inventorySuggestion = suggestBuyHelperTargets(items, query, fees, opts);
  // Dealwatch was checked (caller passed a resolved result) but came back empty — say so
  // explicitly rather than silently falling back to the plain inventory-only note, so the
  // UI can distinguish "never checked" from "checked, found nothing" from "found data".
  if (dealwatchData && !dealwatchData.ebay && !dealwatchData.ka) {
    return {
      ...inventorySuggestion,
      note: `Dealwatch: no live/sold data found for "${query}". ${inventorySuggestion.note || ''}`.trim(),
    };
  }
  if (!dealwatchData) return inventorySuggestion;

  const desired = opts?.desiredMarginPct ?? DEFAULT_DESIRED_MARGIN_PCT;
  const hits = inventoryCompsForQuery(items, query, { category: opts?.category });
  const inv = summarizeInventoryComps(hits);

  const sellEbay = dealwatchData.ebay?.median || inventorySuggestion.sellEbay || 0;
  const sellKa = dealwatchData.ka?.median || inventorySuggestion.sellKa || 0;
  if (sellEbay <= 0 && sellKa <= 0) return inventorySuggestion;

  const maxBuyEbay = sellEbay > 0
    ? maxBuyForNetMargin(pocketFromEbayList(sellEbay, fees), desired, fees.vatOnProfitPct)
    : Infinity;
  const maxBuyKa = sellKa > 0
    ? maxBuyForNetMargin(pocketFromKaList(sellKa), desired, fees.vatOnProfitPct)
    : Infinity;
  const buyPrice = roundMoney(Math.min(maxBuyEbay, maxBuyKa));

  const sourceLabel = [
    dealwatchData.ebay ? `eBay ${dealwatchData.ebay.source === 'ebay-sold' ? 'sold' : 'live'} (n=${dealwatchData.ebay.count})` : null,
    dealwatchData.ka ? `KA live (n=${dealwatchData.ka.count})` : null,
  ].filter(Boolean).join(', ') || (inv ? `${inv.count} inventory comps` : 'no comps');

  const lows = [dealwatchData.ebay?.low, dealwatchData.ka?.low, inv?.low].filter((n): n is number => typeof n === 'number');
  const highs = [dealwatchData.ebay?.high, dealwatchData.ka?.high, inv?.high].filter((n): n is number => typeof n === 'number');
  const medians = [sellEbay, sellKa].filter((n) => n > 0);

  return {
    buyPrice,
    sellKa: sellKa || undefined,
    sellEbay: sellEbay || undefined,
    desiredMarginPct: desired,
    marketLow: lows.length ? Math.min(...lows) : undefined,
    marketMedian: medians.length ? roundMoney(medians.reduce((a, b) => a + b, 0) / medians.length) : undefined,
    marketHigh: highs.length ? Math.max(...highs) : undefined,
    inventoryCompCount: inv?.count ?? 0,
    note: `Dealwatch: ${sourceLabel}. Target ${desired}% net after ${totalEbayFeePct(fees)}% eBay cut + ${fees.vatOnProfitPct}% VAT on profit.`,
    lastCheckedAt: new Date().toISOString(),
  };
}

function migrateFromSoldPulse(legacy: SoldPulseWatchItem[]): BuyHelperItem[] {
  return legacy.map((x) => ({
    id: x.id,
    query: x.query,
    category: x.category,
    note: x.note,
    marketLow: x.low,
    marketMedian: x.median,
    marketHigh: x.high,
    desiredMarginPct: DEFAULT_DESIRED_MARGIN_PCT,
    lastCheckedAt: x.lastCheckedAt,
    createdAt: x.createdAt,
  }));
}

export function loadBuyHelperItems(): BuyHelperItem[] {
  try {
    const raw = localStorage.getItem(BUY_HELPER_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((x) => x && typeof x.id === 'string' && typeof x.query === 'string');
      }
    }
  } catch {
    /* fall through */
  }
  const legacy = loadSoldPulseWatchlist();
  if (legacy.length) {
    const migrated = migrateFromSoldPulse(legacy);
    saveBuyHelperItems(migrated);
    return migrated;
  }
  return [];
}

export function saveBuyHelperItems(items: BuyHelperItem[]): void {
  localStorage.setItem(BUY_HELPER_STORAGE_KEY, JSON.stringify(items.slice(0, 100)));
}

export function seedBuyHelperIfEmpty(items: InventoryItem[]): BuyHelperItem[] {
  const existing = loadBuyHelperItems();
  if (existing.length) return existing;
  const now = new Date().toISOString();
  const fees = loadBuyHelperFees();
  const seeded: BuyHelperItem[] = DEFAULT_SOLD_PULSE_PRESETS.map((p, i) => {
    const base: BuyHelperItem = {
      id: `buy-${i}-${Date.now()}`,
      query: p.query,
      category: p.category,
      desiredMarginPct: DEFAULT_DESIRED_MARGIN_PCT,
      createdAt: now,
    };
    const suggested = suggestBuyHelperTargets(items, p.query, fees, {
      category: p.category,
      desiredMarginPct: DEFAULT_DESIRED_MARGIN_PCT,
    });
    return { ...base, ...suggested, id: base.id, query: base.query, category: base.category, createdAt: now };
  });
  saveBuyHelperItems(seeded);
  return seeded;
}

export function upsertBuyHelperItem(
  list: BuyHelperItem[],
  patch: Partial<BuyHelperItem> & { query: string; category: BuyHelperCategory },
): BuyHelperItem[] {
  const q = patch.query.trim();
  if (!q) return list;
  const now = new Date().toISOString();
  const id = patch.id || `buy-${Date.now()}`;
  const idx = list.findIndex((x) => x.id === id || x.query.toLowerCase() === q.toLowerCase());
  const nextItem: BuyHelperItem = {
    id: idx >= 0 ? list[idx].id : id,
    query: q,
    category: patch.category,
    note: patch.note,
    buyPrice: patch.buyPrice,
    sellKa: patch.sellKa,
    sellEbay: patch.sellEbay,
    desiredMarginPct: patch.desiredMarginPct ?? DEFAULT_DESIRED_MARGIN_PCT,
    marketLow: patch.marketLow,
    marketMedian: patch.marketMedian,
    marketHigh: patch.marketHigh,
    inventoryCompCount: patch.inventoryCompCount,
    lastCheckedAt: patch.lastCheckedAt,
    createdAt: idx >= 0 ? list[idx].createdAt : now,
  };
  let next: BuyHelperItem[];
  if (idx >= 0) {
    next = [...list];
    next[idx] = { ...list[idx], ...nextItem, id: list[idx].id };
  } else {
    next = [nextItem, ...list];
  }
  saveBuyHelperItems(next);
  return next;
}

export function removeBuyHelperItem(list: BuyHelperItem[], id: string): BuyHelperItem[] {
  const next = list.filter((x) => x.id !== id);
  saveBuyHelperItems(next);
  return next;
}

export function sortBuyHelperItems(
  list: BuyHelperItem[],
  fees: BuyHelperFees,
): Array<BuyHelperItem & { analysis: BuyHelperAnalysis }> {
  return list
    .map((item) => ({ ...item, analysis: analyzeBuyHelperItem(item, fees) }))
    .sort((a, b) => {
      const order = { BUY: 0, WAIT: 1, SKIP: 2 };
      const d = order[a.analysis.verdict] - order[b.analysis.verdict];
      if (d !== 0) return d;
      return b.analysis.score - a.analysis.score;
    });
}
