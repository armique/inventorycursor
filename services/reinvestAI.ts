/**
 * AI-hypothesis suggestions for the Reinvest Assistant: products the user has sold 0 times
 * but that plausibly extend their niche. Mirrors services/buyHelperAI.ts — grounded numbers
 * stay bounded relative to the user's own typical buy price, AI only supplies the idea + reason.
 */
import { getSpecsAIProvider, requestAIJson } from './specsAI';
import { roundMoney } from './financialAggregation';
import type { ReinvestGroup } from '../utils/reinvestAnalysis';

export function canUseReinvestAI(): boolean {
  return Boolean(getSpecsAIProvider());
}

export type ReinvestHypothesis = {
  id: string;
  title: string;
  category: string;
  reason: string;
  estBuyPrice: number;
  estSellPrice: number;
};

type RawIdea = {
  title?: string;
  category?: string;
  reason?: string;
  estBuyPrice?: number;
  estSellPrice?: number;
};

/** Suggests 2-3 adjacent products not already in the user's sold categories. Returns [] when no
 * AI provider is configured or the call fails — hypotheses are optional, never block the page.
 * `adjacentCategories` (from utils/reinvestAnalysis.ts's findAdjacentCategories) are component
 * categories that already ride along in the user's own bundles — when present, the model is told
 * to prefer them so suggestions are grounded in real co-occurrence, not a generic guess. */
export async function generateReinvestHypotheses(
  knownCategories: string[],
  avgBuyPrice: number,
  count = 3,
  adjacentCategories: string[] = [],
): Promise<ReinvestHypothesis[]> {
  if (!canUseReinvestAI()) return [];
  const categoriesList = knownCategories.slice(0, 20).join(', ') || 'PC components (unspecified)';
  const priceHint = avgBuyPrice > 0 ? `Their typical buy price is around €${roundMoney(avgBuyPrice)}.` : '';
  const adjacentHint = adjacentCategories.length
    ? `\nTheir own bundle/PC sales already contain these components (${adjacentCategories.join(', ')}) but they have never sold them standalone — strongly prefer these over generic ideas when they fit.`
    : '';

  try {
    const result = await requestAIJson<{ ideas?: RawIdea[] }>(
      `A German PC-parts flipper currently buys and resells these categories: ${categoriesList}. ${priceHint}${adjacentHint}
Suggest ${count} adjacent products they have NOT sold before but that plausibly fit their niche
(e.g. if they sell GPUs and CPUs, PSUs or coolers are adjacent; avoid unrelated categories like phones or furniture).

Return JSON only:
{ "ideas": [{ "title": string, "category": string, "reason": "1-2 short sentences", "estBuyPrice": number, "estSellPrice": number }] }

Rules:
- estSellPrice must be higher than estBuyPrice.
- Keep prices realistic for used PC hardware in EUR.
- Do not repeat any of the categories already listed above.`,
      { maxTokens: 500 },
    );

    const ideas = Array.isArray(result?.ideas) ? result.ideas : [];
    const lo = avgBuyPrice > 0 ? avgBuyPrice * 0.15 : 1;
    const hi = avgBuyPrice > 0 ? avgBuyPrice * 6 : 2000;

    const out: ReinvestHypothesis[] = [];
    ideas.forEach((idea, i) => {
      const buy = Number(idea.estBuyPrice);
      const sell = Number(idea.estSellPrice);
      if (!Number.isFinite(buy) || !Number.isFinite(sell) || buy <= 0 || sell <= buy) return;
      if (buy < lo || buy > hi) return;
      if (!idea.title?.trim()) return;
      out.push({
        id: `hyp-${i}-${Date.now()}`,
        title: idea.title.trim().slice(0, 80),
        category: (idea.category || 'Other').trim().slice(0, 40),
        reason: (idea.reason || '').trim().slice(0, 240),
        estBuyPrice: roundMoney(buy),
        estSellPrice: roundMoney(sell),
      });
    });
    return out.slice(0, count);
  } catch {
    return [];
  }
}

/** Adapts a hypothesis into the same shape ReinvestCard already knows how to render, so the AI
 * path and the sales-grounded path share one component instead of two parallel UIs. */
export function hypothesisToGroup(h: ReinvestHypothesis): ReinvestGroup {
  return {
    key: `hypothesis:${h.id}`,
    kind: 'hypothesis',
    label: h.title,
    category: h.category,
    sampleCategory: h.category,
    soldCount: 0,
    lossCount: 0,
    profitOnlyAvgProfit: null,
    allInclAvgProfit: roundMoney(h.estSellPrice - h.estBuyPrice),
    grossAvgProfit: roundMoney(h.estSellPrice - h.estBuyPrice),
    feesObserved: false,
    avgBuyPrice: h.estBuyPrice,
    avgDaysToSell: 14,
    sellKaMedian: h.estSellPrice,
    sellKaCount: 0,
    sellEbayMedian: null,
    sellEbayCount: 0,
    overallSellMedian: h.estSellPrice,
    sellLow: null,
    sellHigh: null,
    currentStock: 0,
    targetStock: 1,
    confidence: 'low',
    reasonNote: h.reason,
    trend: 'flat',
    profitPerDay: roundMoney((h.estSellPrice - h.estBuyPrice) / 14),
    verdict: 'restock',
    sampleItemIds: [],
    attributedFromKitCount: 0,
  };
}
