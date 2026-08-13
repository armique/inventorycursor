/** Shared pricing calc for ReinvestCard and ReinvestCheatSheet — one place that turns a
 * ReinvestGroup + target margin into buy/sell numbers, reusing utils/reinvestFees.ts math.
 *
 * Always suggests both Kleinanzeigen and eBay list prices. When only one platform has
 * history, the other is derived so pocket money matches (eBay list grossed up for fees).
 */
import type { ReinvestGroup, AnchorBundleGroup } from './reinvestAnalysis';
import {
  channelNet,
  maxBuyForNetMargin,
  pocketFromKaList,
  pocketFromEbayList,
  DEFAULT_DESIRED_MARGIN_PCT,
  type ReinvestFees,
  type ChannelNetResult,
} from './reinvestFees';
import { listPricesForPocket, totalEbayFeePct } from './flipCoach';
import { roundMoney } from '../services/financialAggregation';

export type PriceSource = 'history' | 'derived' | 'none';

export type ReinvestPricing = {
  /** Suggested KA list price. */
  sellKa: number;
  /** Suggested eBay list price (buyer pays this; fees come out of it). */
  sellEbay: number;
  sellKaSource: PriceSource;
  sellEbaySource: PriceSource;
  /** Pocket after KA sale (= sellKa when fees are 0). */
  pocketKa: number;
  /** Pocket after eBay fees on sellEbay. */
  pocketEbay: number;
  /** Combined eBay fee % used (Verkaufsgebühr + ads). */
  ebayFeePct: number;
  suggestedMaxBuy: number | null;
  ka: ChannelNetResult | null;
  ebay: ChannelNetResult | null;
  /** Short advisor line for the card face. */
  advice: string;
};

export function defaultMarginForGroup(group: ReinvestGroup | AnchorBundleGroup): number {
  if (group.avgBuyPrice > 0) {
    const pct = (group.allInclAvgProfit / group.avgBuyPrice) * 100;
    if (Number.isFinite(pct) && pct > 0) {
      return Math.min(80, Math.max(10, Math.round(pct / 5) * 5));
    }
  }
  return DEFAULT_DESIRED_MARGIN_PCT;
}

/**
 * Resolve KA + eBay list targets from sold history.
 * - Prefer platform medians when present.
 * - Cross-fill the missing channel so pocket matches (eBay ≈ pocket / (1 − fee%)).
 * - Fall back to overall sell median as a KA-like list when platform is unknown.
 */
export function resolveChannelListPrices(
  group: ReinvestGroup | AnchorBundleGroup,
  fees: ReinvestFees,
): Pick<
  ReinvestPricing,
  'sellKa' | 'sellEbay' | 'sellKaSource' | 'sellEbaySource' | 'pocketKa' | 'pocketEbay' | 'ebayFeePct'
> {
  const ebayFeePct = totalEbayFeePct(fees);
  const histKa = group.sellKaMedian != null && group.sellKaMedian > 0 ? group.sellKaMedian : null;
  const histEbay = group.sellEbayMedian != null && group.sellEbayMedian > 0 ? group.sellEbayMedian : null;
  const overall = group.overallSellMedian != null && group.overallSellMedian > 0 ? group.overallSellMedian : null;

  let sellKa = 0;
  let sellEbay = 0;
  let sellKaSource: PriceSource = 'none';
  let sellEbaySource: PriceSource = 'none';

  if (histKa != null && histEbay != null) {
    sellKa = histKa;
    sellEbay = histEbay;
    sellKaSource = 'history';
    sellEbaySource = 'history';
  } else if (histKa != null) {
    sellKa = histKa;
    sellKaSource = 'history';
    const derived = listPricesForPocket(histKa, ebayFeePct);
    sellEbay = derived.ebay;
    sellEbaySource = 'derived';
  } else if (histEbay != null) {
    sellEbay = histEbay;
    sellEbaySource = 'history';
    const pocket = pocketFromEbayList(histEbay, fees);
    sellKa = pocket;
    sellKaSource = 'derived';
  } else if (overall != null) {
    // Unknown / mixed platform — treat overall as list; suggest both channels for same pocket.
    sellKa = overall;
    sellKaSource = 'history';
    const derived = listPricesForPocket(overall, ebayFeePct);
    sellEbay = derived.ebay;
    sellEbaySource = 'derived';
  }

  return {
    sellKa: roundMoney(sellKa),
    sellEbay: roundMoney(sellEbay),
    sellKaSource,
    sellEbaySource,
    pocketKa: sellKa > 0 ? pocketFromKaList(sellKa) : 0,
    pocketEbay: sellEbay > 0 ? pocketFromEbayList(sellEbay, fees) : 0,
    ebayFeePct,
  };
}

function buildAdvice(
  group: ReinvestGroup | AnchorBundleGroup,
  pricing: Pick<ReinvestPricing, 'suggestedMaxBuy' | 'sellKa' | 'sellEbay' | 'ebayFeePct' | 'sellEbaySource'>,
): string {
  if (group.kind === 'hypothesis') {
    return 'AI idea — verify Dealwatch prices before buying.';
  }
  if (!group.soldCount) {
    return 'Not enough sold history yet.';
  }

  const bits: string[] = [];
  if (group.verdict === 'restock') {
    bits.push(`Restock — ${group.currentStock} of ${group.targetStock} in stock`);
  } else if (group.verdict === 'stocked') {
    bits.push(`Stocked (${group.currentStock}/${group.targetStock})`);
  } else {
    bits.push('Skip for now');
  }

  if (pricing.suggestedMaxBuy != null) {
    bits.push(`buy ≤ €${Math.round(pricing.suggestedMaxBuy)}`);
  }
  if (pricing.sellKa > 0) {
    bits.push(`KA ~€${Math.round(pricing.sellKa)}`);
  }
  if (pricing.sellEbay > 0) {
    const tag = pricing.sellEbaySource === 'derived' ? ` (≈${pricing.ebayFeePct}% fees)` : '';
    bits.push(`eBay ~€${Math.round(pricing.sellEbay)}${tag}`);
  }
  if (group.profitPerDay > 0) {
    bits.push(`~€${group.profitPerDay.toFixed(1)}/day`);
  }
  return bits.join(' · ');
}

export function computeReinvestPricing(
  group: ReinvestGroup | AnchorBundleGroup,
  fees: ReinvestFees,
  marginPct: number,
): ReinvestPricing {
  const channels = resolveChannelListPrices(group, fees);
  const { sellKa, sellEbay } = channels;

  const caps: number[] = [];
  if (sellKa > 0) caps.push(maxBuyForNetMargin(pocketFromKaList(sellKa), marginPct, fees.vatOnProfitPct));
  if (sellEbay > 0) caps.push(maxBuyForNetMargin(pocketFromEbayList(sellEbay, fees), marginPct, fees.vatOnProfitPct));
  const suggestedMaxBuy = caps.length ? Math.min(...caps) : null;

  const ka =
    suggestedMaxBuy != null && sellKa > 0 ? channelNet(sellKa, suggestedMaxBuy, 'ka', fees, marginPct) : null;
  const ebay =
    suggestedMaxBuy != null && sellEbay > 0 ? channelNet(sellEbay, suggestedMaxBuy, 'ebay', fees, marginPct) : null;

  const result: ReinvestPricing = {
    ...channels,
    suggestedMaxBuy,
    ka,
    ebay,
    advice: '',
  };
  result.advice = buildAdvice(group, result);
  return result;
}
