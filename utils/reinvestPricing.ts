/** Shared pricing calc for ReinvestCard and ReinvestCheatSheet — one place that turns a
 * ReinvestGroup + target margin into buy/sell numbers, reusing utils/buyHelper.ts's math. */
import type { ReinvestGroup, AnchorBundleGroup } from './reinvestAnalysis';
import {
  channelNet,
  maxBuyForNetMargin,
  pocketFromKaList,
  pocketFromEbayList,
  DEFAULT_DESIRED_MARGIN_PCT,
  type BuyHelperFees,
  type ChannelNetResult,
} from './buyHelper';

export type ReinvestPricing = {
  sellKa: number;
  sellEbay: number;
  suggestedMaxBuy: number | null;
  ka: ChannelNetResult | null;
  ebay: ChannelNetResult | null;
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

export function computeReinvestPricing(
  group: ReinvestGroup | AnchorBundleGroup,
  fees: BuyHelperFees,
  marginPct: number,
): ReinvestPricing {
  const sellKa = group.sellKaMedian ?? group.overallSellMedian ?? 0;
  const sellEbay = group.sellEbayMedian ?? group.overallSellMedian ?? 0;
  const caps: number[] = [];
  if (sellKa > 0) caps.push(maxBuyForNetMargin(pocketFromKaList(sellKa), marginPct, fees.vatOnProfitPct));
  if (sellEbay > 0) caps.push(maxBuyForNetMargin(pocketFromEbayList(sellEbay, fees), marginPct, fees.vatOnProfitPct));
  const suggestedMaxBuy = caps.length ? Math.min(...caps) : null;
  const ka = suggestedMaxBuy != null && sellKa > 0 ? channelNet(sellKa, suggestedMaxBuy, 'ka', fees, marginPct) : null;
  const ebay =
    suggestedMaxBuy != null && sellEbay > 0 ? channelNet(sellEbay, suggestedMaxBuy, 'ebay', fees, marginPct) : null;
  return { sellKa, sellEbay, suggestedMaxBuy, ka, ebay };
}
