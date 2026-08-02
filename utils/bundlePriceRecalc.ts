/**
 * Redistributes a sold bundle/PC's total sell price across its components — instead of naive
 * equal division (which makes RAM look as valuable as a GPU), each part's share comes from:
 * 1) this account's own real standalone sale data for that exact variant, when there's enough
 *    of it to trust (>=2 sales) — the most honest signal, since it's this seller's own Dealwatch signal.
 * 2) otherwise a category-based prior (GPU/CPU carry more of a build's value than RAM/PSU/case),
 *    reflecting typical relative component value.
 * Pure function — callers decide whether/how to apply the result (see ReinvestBundleRecalcModal).
 */
import type { InventoryItem } from '../types';
import { getChildren, roundMoney } from '../services/financialAggregation';
import { variantKeyForItem, buildVariantGroups } from './reinvestAnalysis';
import { extractPrimaryComponentKey, type ComponentCategory } from './componentKeyExtractor';

const CATEGORY_BASE_WEIGHT: Record<ComponentCategory, number> = {
  gpu: 5,
  cpu: 3,
  motherboard: 2,
  ram: 1.2,
  storage: 1.2,
  psu: 1,
  case: 0.8,
  cooler: 0.6,
};
const UNRECOGNIZED_PART_WEIGHT = 0.7;

export type ComponentPriceSuggestion = {
  itemId: string;
  name: string;
  oldSellPrice: number | null;
  newSellPrice: number;
  /** 'dealwatch' = based on this account's own standalone sales of the same variant (>=2 sales).
   * 'category' = fallback prior (GPU/CPU worth more of the build than RAM/PSU/case/etc). */
  weightSource: 'dealwatch' | 'category';
};

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
    const key = variantKeyForItem(child);
    const dealwatchGroup = dealwatchByKey.get(key);
    if (dealwatchGroup && dealwatchGroup.soldCount >= 2 && (dealwatchGroup.overallSellMedian ?? 0) > 0) {
      return { child, weight: dealwatchGroup.overallSellMedian!, source: 'dealwatch' as const };
    }
    const match = extractPrimaryComponentKey(child.name || '');
    const weight = match ? CATEGORY_BASE_WEIGHT[match.category] : UNRECOGNIZED_PART_WEIGHT;
    return { child, weight, source: 'category' as const };
  });

  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
  if (!(totalWeight > 0)) return [];

  return weighted.map(({ child, weight, source }) => ({
    itemId: child.id,
    name: child.name,
    oldSellPrice: typeof child.sellPrice === 'number' ? child.sellPrice : null,
    newSellPrice: roundMoney(containerSell * (weight / totalWeight)),
    weightSource: source,
  }));
}
