/**
 * Redistributes a sold bundle/PC's total sell price across its components.
 *
 * Weights stay on one euro-scale so a GPU Dealwatch median (~€700) can never be
 * mixed with a tiny category prior (~3) and crush a real CPU cost to pennies.
 *
 * Priority for each part's weight:
 * 1) buy price (what you paid) — primary anchor whenever present
 * 2) this account's standalone sell median for that variant (2+ sales) — only if no buy
 * 3) category euro priors when neither buy nor Dealwatch exists
 *
 * Using cost share (not raw comps) keeps historical part sells usable for later
 * price suggestions instead of inventing a €6 14700K.
 *
 * Pure function — callers decide whether/how to apply (see ReinvestBundleRecalcModal).
 */
import type { InventoryItem } from '../types';
import { getChildren, roundMoney } from '../services/financialAggregation';
import { variantKeyForItem, buildVariantGroups } from './reinvestAnalysis';
import { extractPrimaryComponentKey, type ComponentCategory } from './componentKeyExtractor';

/** Typical standalone euro value — used only when a part has no buy price. */
const CATEGORY_EUR_PRIOR: Record<ComponentCategory, number> = {
  gpu: 450,
  cpu: 280,
  motherboard: 120,
  ram: 80,
  storage: 70,
  psu: 60,
  case: 50,
  cooler: 40,
};
const UNRECOGNIZED_EUR_PRIOR = 50;

export type ComponentPriceSuggestion = {
  itemId: string;
  name: string;
  oldSellPrice: number | null;
  newSellPrice: number;
  /** 'buy' = cost share; 'dealwatch' = own sales (no buy); 'category' = typical prior. */
  weightSource: 'dealwatch' | 'category' | 'buy';
};

function categoryEuroPrior(name: string): number {
  const match = extractPrimaryComponentKey(name || '');
  return match ? CATEGORY_EUR_PRIOR[match.category] : UNRECOGNIZED_EUR_PRIOR;
}

/** Returns [] when the container has no sell price or no children to split it across. */
export function suggestBundleComponentPrices(
  container: InventoryItem,
  allItems: InventoryItem[],
): ComponentPriceSuggestion[] {
  const children = getChildren(container, allItems);
  // Prefer the container's own sell; when that was cleared / never set (proportional child
  // sales), fall back to the sum of part sells so recalc still has a total to redistribute.
  const childrenSellSum = children.reduce((sum, c) => sum + (Number(c.sellPrice) || 0), 0);
  const containerSell = Number(container.sellPrice) || childrenSellSum || 0;
  if (!children.length || containerSell <= 0) return [];

  // Bundle children are already excluded from groupSalesByVariant's standalone pool, so this
  // lookup is a clean read of the account's own OTHER (non-bundle) sales — not circular.
  const dealwatchByKey = new Map(buildVariantGroups(allItems).map((g) => [g.key, g]));

  const weighted = children.map((child) => {
    const buy = Number(child.buyPrice) || 0;
    if (buy > 0) {
      return { child, weight: buy, source: 'buy' as const };
    }

    const key = variantKeyForItem(child);
    const dealwatchGroup = dealwatchByKey.get(key);
    const market =
      dealwatchGroup && dealwatchGroup.soldCount >= 2 && (dealwatchGroup.overallSellMedian ?? 0) > 0
        ? dealwatchGroup.overallSellMedian!
        : 0;
    if (market > 0) {
      return { child, weight: market, source: 'dealwatch' as const };
    }
    return { child, weight: categoryEuroPrior(child.name || ''), source: 'category' as const };
  });

  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
  if (!(totalWeight > 0)) return [];

  // Largest-remainder so rounded cents still sum exactly to containerSell.
  const raw = weighted.map(({ child, weight, source }) => {
    const exact = containerSell * (weight / totalWeight);
    const floored = Math.floor(exact * 100) / 100;
    return {
      child,
      source,
      floored,
      frac: exact - floored,
    };
  });
  let remainderCents = Math.round((containerSell - raw.reduce((s, r) => s + r.floored, 0)) * 100);
  const byFrac = [...raw.keys()].sort((a, b) => raw[b].frac - raw[a].frac);
  for (const idx of byFrac) {
    if (remainderCents <= 0) break;
    raw[idx].floored = roundMoney(raw[idx].floored + 0.01);
    remainderCents -= 1;
  }

  return raw.map(({ child, source, floored }) => ({
    itemId: child.id,
    name: child.name,
    oldSellPrice: typeof child.sellPrice === 'number' ? child.sellPrice : null,
    newSellPrice: floored,
    weightSource: source,
  }));
}
