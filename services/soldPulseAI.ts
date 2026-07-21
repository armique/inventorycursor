/**
 * Optional AI helper for Sold Pulse.
 * Only summarizes prices YOU pasted from eBay — never invents sold comps.
 */

import { getSpecsAIProvider, requestAIJson } from './specsAI';
import { extractPricesFromPaste, summarizePriceList } from '../utils/ebaySoldPulse';

export type SoldPulseAiSummary = {
  low: number;
  median: number;
  high: number;
  count: number;
  /** Plain advice — ignore Defekt/auctions/outliers */
  advice: string;
  /** Warnings AI noticed in the paste */
  warnings: string[];
  /** true when AI ran; false when local math only */
  usedAi: boolean;
};

export function canUseSoldPulseAi(): boolean {
  return Boolean(getSpecsAIProvider());
}

/**
 * Prefer local price extraction; optionally ask AI to filter junk and explain.
 */
export async function summarizePastedSoldComps(
  query: string,
  pastedText: string
): Promise<SoldPulseAiSummary> {
  const localPrices = extractPricesFromPaste(pastedText);
  const local = summarizePriceList(localPrices);

  if (!local) {
    throw new Error(
      'No euro prices found in the paste. Copy a few sold rows from eBay (with € amounts) and try again.'
    );
  }

  if (!canUseSoldPulseAi() || pastedText.trim().length < 40) {
    return {
      low: local.low,
      median: local.median,
      high: local.high,
      count: local.count,
      advice: 'Local math from the € amounts you pasted (no AI). Skip Defekt and weird auction outliers by hand.',
      warnings: local.count < 3 ? ['Few prices — check more sold listings before trusting this.'] : [],
      usedAi: false,
    };
  }

  try {
    const result = await requestAIJson<{
      low?: number;
      median?: number;
      high?: number;
      count?: number;
      advice?: string;
      warnings?: string[];
    }>(
      `You help a German PC-parts reseller read eBay.de SOLD listings.
Product query: "${query}"

The user pasted real sold-result text from eBay. Extract ONLY realistic BUY-IT-NOW / fixed-price style used sales for WORKING units.
IGNORE or down-weight: Defekt/for parts, auctions with 1 bidder giveaways, wrong models, lots/bundles unless the query is a lot, shipping-only weirdness.

Pasted text:
"""
${pastedText.slice(0, 6000)}
"""

Local extracted prices (may include junk): low=${local.low}, median=${local.median}, high=${local.high}, count=${local.count}

Return JSON only:
{
  "low": number,
  "median": number,
  "high": number,
  "count": number,
  "advice": "1-2 short sentences in simple English or German",
  "warnings": ["short warning", "..."]
}

Rules:
- Numbers must be grounded in the pasted text (or the local extract). Do NOT invent market prices from memory.
- If paste is too messy, keep local median and warn.
- count = how many usable comps you trusted.`,
      { maxTokens: 400 }
    );

    const low = Number(result.low);
    const median = Number(result.median);
    const high = Number(result.high);
    const count = Number(result.count);
    const grounded =
      Number.isFinite(low) &&
      Number.isFinite(median) &&
      Number.isFinite(high) &&
      median >= local.low * 0.5 &&
      median <= local.high * 1.5;

    if (!grounded) {
      return {
        ...localBase(local),
        advice: 'AI result looked off — kept your pasted € math instead.',
        warnings: ['Trust the local numbers; re-check eBay sold filters (Used + Buy It Now).'],
        usedAi: true,
      };
    }

    return {
      low: Math.round(low * 100) / 100,
      median: Math.round(median * 100) / 100,
      high: Math.round(high * 100) / 100,
      count: Number.isFinite(count) && count > 0 ? Math.round(count) : local.count,
      advice: String(result.advice || 'Filtered obvious junk from your paste.').slice(0, 280),
      warnings: Array.isArray(result.warnings)
        ? result.warnings.map((w) => String(w).slice(0, 160)).slice(0, 4)
        : [],
      usedAi: true,
    };
  } catch {
    return {
      ...localBase(local),
      advice: 'AI unavailable — used local € extraction from your paste.',
      warnings: [],
      usedAi: false,
    };
  }
}

function localBase(local: NonNullable<ReturnType<typeof summarizePriceList>>): Omit<
  SoldPulseAiSummary,
  'advice' | 'warnings' | 'usedAi'
> {
  return {
    low: local.low,
    median: local.median,
    high: local.high,
    count: local.count,
  };
}
