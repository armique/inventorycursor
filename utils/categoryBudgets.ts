/**
 * Per-category "reinvest budget": net cash a component category has generated since a season
 * baseline (sold − bought), i.e. how much of that category's own money is free to put back into
 * buying more of it. Pure function over `items` — recomputes on every call, so it's always live.
 */
import type { InventoryItem } from '../types';
import { isRealizedDisposal } from './itemDisposition';
import { roundMoney, shouldSkipContainerForPurchaseCogs, shouldSkipForAggregatedSaleLine } from '../services/financialAggregation';
import { extractPrimaryComponentKey, type ComponentCategory } from './componentKeyExtractor';
import { COMPONENT_CATEGORY_LABELS } from './reinvestAnalysis';

export type CategoryBudgetKey = ComponentCategory | 'other';

export type CategoryBudget = {
  key: CategoryBudgetKey;
  label: string;
  bought: number;
  sold: number;
  budget: number;
  buyCount: number;
  sellCount: number;
};

/** Meteorological start of the current summer (Jun 1) — last year's if we haven't hit it yet. */
export function getSeasonStartDate(referenceDate: Date = new Date()): string {
  const year = referenceDate.getMonth() >= 5 ? referenceDate.getFullYear() : referenceDate.getFullYear() - 1;
  return `${year}-06-01`;
}

/** Whole PCs/bundles sold as one lump sum don't belong to a single component category. */
function categoryForBudget(item: InventoryItem): CategoryBudgetKey {
  if (item.isBundle || item.isPC) return 'other';
  const match = extractPrimaryComponentKey(item.name || '');
  return match ? match.category : 'other';
}

export function computeCategoryBudgets(
  items: InventoryItem[],
  sinceDate: string = getSeasonStartDate(),
): CategoryBudget[] {
  const buckets = new Map<CategoryBudgetKey, { bought: number; sold: number; buyCount: number; sellCount: number }>();
  const ensure = (key: CategoryBudgetKey) => {
    let b = buckets.get(key);
    if (!b) {
      b = { bought: 0, sold: 0, buyCount: 0, sellCount: 0 };
      buckets.set(key, b);
    }
    return b;
  };

  for (const item of items) {
    if (item.isDraft) continue;
    const cat = categoryForBudget(item);

    if (!shouldSkipContainerForPurchaseCogs(item, items)) {
      const buy = Number(item.buyPrice) || 0;
      if (buy > 0 && item.buyDate && item.buyDate >= sinceDate) {
        const b = ensure(cat);
        b.bought = roundMoney(b.bought + buy);
        b.buyCount += 1;
      }
    }

    if (isRealizedDisposal(item) && !shouldSkipForAggregatedSaleLine(item, items)) {
      const sell = Number(item.sellPrice) || 0;
      if (sell > 0 && item.sellDate && item.sellDate >= sinceDate) {
        const b = ensure(cat);
        b.sold = roundMoney(b.sold + sell);
        b.sellCount += 1;
      }
    }
  }

  const out: CategoryBudget[] = [];
  for (const [key, b] of buckets) {
    out.push({
      key,
      label: key === 'other' ? 'Other' : COMPONENT_CATEGORY_LABELS[key],
      bought: b.bought,
      sold: b.sold,
      budget: roundMoney(b.sold - b.bought),
      buyCount: b.buyCount,
      sellCount: b.sellCount,
    });
  }
  return out.sort((a, b) => b.budget - a.budget);
}
