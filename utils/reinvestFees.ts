/** eBay fee + VAT-on-profit settings shared by Reinvest pricing math. */

import { roundMoney } from '../services/financialAggregation';
import {
  DEFAULT_FLIP_FEES,
  loadFlipFees,
  totalEbayFeePct,
  type FlipFeeSettings,
} from './flipCoach';

export const REINVEST_VAT_KEY = 'buy_helper_vat_pct_v1';

export type ReinvestFees = FlipFeeSettings & {
  /** VAT taken from profit after platform fees (default 19). */
  vatOnProfitPct: number;
};

export const DEFAULT_REINVEST_VAT = 19;
export const DEFAULT_DESIRED_MARGIN_PCT = 35;

export function loadReinvestVatPct(): number {
  try {
    const raw = localStorage.getItem(REINVEST_VAT_KEY);
    if (raw == null) return DEFAULT_REINVEST_VAT;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_REINVEST_VAT;
    return Math.min(40, Math.max(0, n));
  } catch {
    return DEFAULT_REINVEST_VAT;
  }
}

export function saveReinvestVatPct(pct: number): void {
  const n = Math.min(40, Math.max(0, Number(pct) || 0));
  localStorage.setItem(REINVEST_VAT_KEY, String(n));
}

export function loadReinvestFees(): ReinvestFees {
  const flip = loadFlipFees();
  return {
    ebayFeePct: flip.ebayFeePct ?? DEFAULT_FLIP_FEES.ebayFeePct,
    ebayAdsPct: flip.ebayAdsPct ?? DEFAULT_FLIP_FEES.ebayAdsPct,
    vatOnProfitPct: loadReinvestVatPct(),
  };
}

export function pocketFromKaList(listEuro: number): number {
  return roundMoney(Math.max(0, listEuro));
}

export function pocketFromEbayList(listEuro: number, fees: ReinvestFees): number {
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
  fees: ReinvestFees,
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
