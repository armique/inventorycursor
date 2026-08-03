/**
 * Per-category "reinvest budget": net cash a component category has generated since a season
 * baseline (sold − bought). Attributed PC/bundle part sells credit the part category; lump-sum
 * PC sales without part prices stay in Other (and are surfaced so the UI can explain).
 */
import type { InventoryItem } from '../types';
import { isRealizedDisposal } from './itemDisposition';
import {
  getChildren,
  getParentContainer,
  roundMoney,
  shouldSkipContainerForPurchaseCogs,
  shouldSkipForAggregatedSaleLine,
} from '../services/financialAggregation';
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

export type CategoryBudgetsResult = {
  budgets: CategoryBudget[];
  /** € from sold PCs/bundles that had no per-part sell prices — credited only to Other. */
  unattributedPcSold: number;
  unattributedPcCount: number;
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
  return computeCategoryBudgetsDetailed(items, sinceDate).budgets;
}

export function computeCategoryBudgetsDetailed(
  items: InventoryItem[],
  sinceDate: string = getSeasonStartDate(),
): CategoryBudgetsResult {
  const buckets = new Map<CategoryBudgetKey, { bought: number; sold: number; buyCount: number; sellCount: number }>();
  const ensure = (key: CategoryBudgetKey) => {
    let b = buckets.get(key);
    if (!b) {
      b = { bought: 0, sold: 0, buyCount: 0, sellCount: 0 };
      buckets.set(key, b);
    }
    return b;
  };

  /** Containers whose children already took the sold € into part categories. */
  const containersAttributed = new Set<string>();
  let unattributedPcSold = 0;
  let unattributedPcCount = 0;

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

    // Parts inside a sold PC/bundle with their own sell price → credit the part category
    // (even when status stays IN_COMPOSITION and would normally be skipped).
    if (!item.isBundle && !item.isPC) {
      const parent = getParentContainer(item, items);
      const sell = Number(item.sellPrice) || 0;
      if (parent && (parent.isPC || parent.isBundle) && isRealizedDisposal(parent) && sell > 0) {
        const sellDate = item.sellDate || parent.sellDate;
        if (sellDate && sellDate >= sinceDate) {
          const partCat = categoryForBudget(item);
          const b = ensure(partCat);
          b.sold = roundMoney(b.sold + sell);
          b.sellCount += 1;
          containersAttributed.add(parent.id);
        }
        continue;
      }
    }

    if (isRealizedDisposal(item) && !shouldSkipForAggregatedSaleLine(item, items)) {
      const sell = Number(item.sellPrice) || 0;
      if (!(sell > 0 && item.sellDate && item.sellDate >= sinceDate)) continue;

      if ((item.isPC || item.isBundle) && containersAttributed.has(item.id)) {
        // Part sells already counted — do not double-count the shell total into Other.
        continue;
      }

      if (item.isPC || item.isBundle) {
        const children = getChildren(item, items);
        const anyAttributed = children.some((c) => (Number(c.sellPrice) || 0) > 0);
        if (!anyAttributed) {
          unattributedPcSold = roundMoney(unattributedPcSold + sell);
          unattributedPcCount += 1;
        }
      }

      const b = ensure(cat);
      b.sold = roundMoney(b.sold + sell);
      b.sellCount += 1;
    }
  }

  const budgets: CategoryBudget[] = [];
  for (const [key, b] of buckets) {
    budgets.push({
      key,
      label: key === 'other' ? 'Other' : COMPONENT_CATEGORY_LABELS[key],
      bought: b.bought,
      sold: b.sold,
      budget: roundMoney(b.sold - b.bought),
      buyCount: b.buyCount,
      sellCount: b.sellCount,
    });
  }
  budgets.sort((a, b) => b.budget - a.budget);

  return { budgets, unattributedPcSold, unattributedPcCount };
}
