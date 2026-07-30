/**
 * Optional AI assist for Buy Helper — suggests buy/sell/margin using
 * inventory comps + pasted Dealwatch text. Never invents sold prices from memory.
 */

import { getSpecsAIProvider, requestAIJson } from './specsAI';
import { extractPricesFromPaste, summarizePriceList } from '../utils/ebaySoldPulse';
import {
  DEFAULT_DESIRED_MARGIN_PCT,
  maxBuyForNetMargin,
  pocketFromEbayList,
  pocketFromKaList,
  type BuyHelperFees,
  type BuyHelperItem,
} from '../utils/buyHelper';
import { listPricesForPocket, totalEbayFeePct } from '../utils/flipCoach';
import { roundMoney } from '../services/financialAggregation';

export function canUseBuyHelperAi(): boolean {
  return Boolean(getSpecsAIProvider());
}

export type BuyHelperAiResult = {
  buyPrice: number;
  sellKa: number;
  sellEbay: number;
  desiredMarginPct: number;
  marketLow?: number;
  marketMedian?: number;
  marketHigh?: number;
  advice: string;
  usedAi: boolean;
};

/**
 * Build editable targets from inventory pocket median and optional paste.
 * AI only refines advice / margin when available — numbers stay grounded.
 */
export async function generateBuyHelperWithAi(input: {
  query: string;
  fees: BuyHelperFees;
  /** Pocket median from your sold inventory (incl. bundle attribution). */
  inventoryPocketMedian?: number;
  inventoryCompCount?: number;
  inventoryLow?: number;
  inventoryHigh?: number;
  pastedText?: string;
  current?: Partial<BuyHelperItem>;
}): Promise<BuyHelperAiResult> {
  const desired =
    Number(input.current?.desiredMarginPct) > 0
      ? Number(input.current?.desiredMarginPct)
      : DEFAULT_DESIRED_MARGIN_PCT;

  const pastePrices = extractPricesFromPaste(input.pastedText || '');
  const pasteSummary = summarizePriceList(pastePrices);

  // Prefer inventory pocket (already fee-adjusted historically); paste is gross sold list-ish.
  let pocket = Number(input.inventoryPocketMedian) || 0;
  let marketLow = input.inventoryLow;
  let marketHigh = input.inventoryHigh;
  let marketMedian = pocket || undefined;

  if (pasteSummary) {
    // Treat paste median as KA-like sold price (buyer paid); use as pocket/KA target.
    const pastePocket = pasteSummary.median;
    if (pocket <= 0) pocket = pastePocket;
    else pocket = roundMoney(pocket * 0.55 + pastePocket * 0.45);
    marketLow = Math.min(marketLow ?? pasteSummary.low, pasteSummary.low);
    marketHigh = Math.max(marketHigh ?? pasteSummary.high, pasteSummary.high);
    marketMedian = roundMoney(pocket);
  }

  if (pocket <= 0) {
    throw new Error(
      'No price signal yet. Need sold inventory comps for this part (including from bundles) or paste eBay sold € rows.',
    );
  }

  const feePct = totalEbayFeePct(input.fees);
  const lists = listPricesForPocket(pocket, feePct);
  const buyFromEbay = maxBuyForNetMargin(
    pocketFromEbayList(lists.ebay, input.fees),
    desired,
    input.fees.vatOnProfitPct,
  );
  const buyFromKa = maxBuyForNetMargin(
    pocketFromKaList(lists.kleinanzeigen),
    desired,
    input.fees.vatOnProfitPct,
  );
  let buyPrice = roundMoney(Math.min(buyFromEbay, buyFromKa));
  let sellKa = lists.kleinanzeigen;
  let sellEbay = lists.ebay;
  let desiredMarginPct = desired;
  let advice = `From ${input.inventoryCompCount || 0} inventory comps` +
    (pasteSummary ? ` + ${pasteSummary.count} pasted sold prices` : '') +
    `. eBay cut ${feePct}% (fee+ads), then ${input.fees.vatOnProfitPct}% VAT on profit.`;
  let usedAi = false;

  if (canUseBuyHelperAi()) {
    try {
      const result = await requestAIJson<{
        buyPrice?: number;
        sellKa?: number;
        sellEbay?: number;
        desiredMarginPct?: number;
        advice?: string;
      }>(
        `You help a German PC-parts flipper decide BUY prices.
Product: "${input.query}"

Ground truth (do NOT invent other Dealwatch prices):
- Inventory pocket median (your real sales, may include bundle-attributed parts): €${pocket}
- Inventory comps: ${input.inventoryCompCount || 0}
- Suggested KA list (0% fees): €${sellKa}
- Suggested eBay list (after ${feePct}% fee+ads → same pocket): €${sellEbay}
- Max buy for ~${desired}% NET margin after fees + ${input.fees.vatOnProfitPct}% VAT on profit: €${buyPrice}
- Pasted sold summary: ${pasteSummary ? `low €${pasteSummary.low}, median €${pasteSummary.median}, high €${pasteSummary.high}, n=${pasteSummary.count}` : 'none'}

Return JSON only:
{
  "buyPrice": number,
  "sellKa": number,
  "sellEbay": number,
  "desiredMarginPct": number,
  "advice": "1-2 short sentences"
}

Rules:
- Numbers must stay within ~20% of the grounded suggestions above (or pasted median).
- sellEbay must be higher than sellKa when feePct > 0 so pocket is similar.
- desiredMarginPct between 15 and 60.
- Prefer conservative buyPrice (lower) when sample is thin (<3 comps).`,
        { maxTokens: 350 },
      );

      const clampNear = (n: number, base: number) => {
        if (!Number.isFinite(n) || n <= 0) return base;
        const lo = base * 0.8;
        const hi = base * 1.2;
        return roundMoney(Math.min(hi, Math.max(lo, n)));
      };

      buyPrice = clampNear(Number(result.buyPrice), buyPrice);
      sellKa = clampNear(Number(result.sellKa), sellKa);
      sellEbay = clampNear(Number(result.sellEbay), sellEbay);
      if (sellEbay < sellKa) sellEbay = roundMoney(sellKa / (1 - Math.min(0.85, feePct / 100)));
      const dm = Number(result.desiredMarginPct);
      if (Number.isFinite(dm)) desiredMarginPct = Math.min(60, Math.max(15, Math.round(dm)));
      advice = String(result.advice || advice).slice(0, 280);
      usedAi = true;
    } catch {
      /* keep local grounded numbers */
    }
  }

  return {
    buyPrice,
    sellKa,
    sellEbay,
    desiredMarginPct,
    marketLow,
    marketMedian,
    marketHigh,
    advice,
    usedAi,
  };
}
