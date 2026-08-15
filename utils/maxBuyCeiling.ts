import type { InventoryItem } from '../types';
import { getCachedSaleEvents, findPoolComps } from './itemSalesPool';
import { roundMoney } from '../services/financialAggregation';

/** Share of sold median you may pay before fees, shipping, and sit-risk. */
export const MAX_BUY_MEDIAN_SHARE = 0.55;
/** Flat 14-day stale-stock haircut on the raw ceiling. */
export const MAX_BUY_SIT_RISK_SHARE = 0.08;
export const DEFAULT_SHIPPING_EUR = 8;

export type FulfillmentMode = 'pickup' | 'ship';

export type MaxBuyQuote = {
  query: string;
  soldMedian: number;
  compCount: number;
  rawCeiling: number;
  sitRisk: number;
  shipping: number;
  maxBuy: number;
  askPrice: number | null;
  verdict: 'buy' | 'borderline' | 'skip' | 'no_comps';
  reason: string;
};

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function quoteMaxBuy(
  items: InventoryItem[],
  query: string,
  opts?: {
    askPrice?: number;
    fulfillment?: FulfillmentMode;
    shippingEur?: number;
    category?: string;
    subCategory?: string;
  },
): MaxBuyQuote {
  const q = query.trim();
  const events = getCachedSaleEvents(items);
  const hits = q.length >= 3
    ? findPoolComps(events, q, {
        category: opts?.category,
        subCategory: opts?.subCategory,
        limit: 14,
      })
    : [];
  const sells = hits.map((h) => h.event.allocatedSell).filter((n) => n > 0);
  const soldMedian = roundMoney(median(sells));
  const compCount = sells.length;
  const shipping =
    opts?.fulfillment === 'ship'
      ? Math.max(0, opts.shippingEur ?? DEFAULT_SHIPPING_EUR)
      : 0;
  const rawCeiling = roundMoney(soldMedian * MAX_BUY_MEDIAN_SHARE);
  const sitRisk = roundMoney(rawCeiling * MAX_BUY_SIT_RISK_SHARE);
  const maxBuy = Math.max(0, roundMoney(rawCeiling - sitRisk - shipping));
  const ask = opts?.askPrice != null && Number.isFinite(opts.askPrice) ? opts.askPrice : null;

  if (!compCount || !(soldMedian > 0)) {
    return {
      query: q,
      soldMedian: 0,
      compCount: 0,
      rawCeiling: 0,
      sitRisk: 0,
      shipping,
      maxBuy: 0,
      askPrice: ask,
      verdict: 'no_comps',
      reason: 'No sold comps yet — use Reinvest max-buy or skip.',
    };
  }

  let verdict: MaxBuyQuote['verdict'] = 'buy';
  let reason = `Median sold €${soldMedian.toFixed(0)} · ceiling 55% − 14d risk − ${shipping ? `ship €${shipping}` : 'pickup'}.`;
  if (ask != null && ask > 0) {
    if (ask > maxBuy * 1.08) {
      verdict = 'skip';
      reason = `Ask €${ask.toFixed(0)} is over max €${maxBuy.toFixed(0)} — don't open the chat.`;
    } else if (ask > maxBuy) {
      verdict = 'borderline';
      reason = `Ask €${ask.toFixed(0)} is just over max €${maxBuy.toFixed(0)} — only if pickup and mint.`;
    } else {
      verdict = 'buy';
      reason = `Ask €${ask.toFixed(0)} ≤ max €${maxBuy.toFixed(0)}. ${opts?.fulfillment === 'ship' ? 'Shipping already deducted.' : 'Pickup — full ceiling.'}`;
    }
  }

  return {
    query: q,
    soldMedian,
    compCount,
    rawCeiling,
    sitRisk,
    shipping,
    maxBuy,
    askPrice: ask,
    verdict,
    reason,
  };
}
