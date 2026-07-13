import type { InventoryItem } from '../types';
import { getEffectiveSellPrice } from './ebaySaleAdjustments';

export type AmountFilterField = 'sell' | 'buy' | 'either';

export interface AmountFilterState {
  field: AmountFilterField;
  /** Exact match (EUR), e.g. 22.33 */
  exact?: number;
  min?: number;
  max?: number;
}

export const EMPTY_AMOUNT_FILTER: AmountFilterState = { field: 'sell' };

export function isAmountFilterActive(filter: AmountFilterState): boolean {
  return filter.exact != null || filter.min != null || filter.max != null;
}

function itemAmountValues(item: InventoryItem, field: AmountFilterField): number[] {
  const out: number[] = [];
  if (field === 'sell' || field === 'either') {
    const sell = getEffectiveSellPrice(item) ?? item.sellPrice;
    if (sell != null && Number.isFinite(sell)) out.push(sell);
  }
  if (field === 'buy' || field === 'either') {
    const buy = item.buyPrice;
    if (buy != null && Number.isFinite(buy)) out.push(buy);
  }
  return out;
}

/** Match inventory row against sell/buy amount filter (±2 ct tolerance on exact). */
export function itemMatchesAmountFilter(
  item: InventoryItem,
  filter: AmountFilterState,
  tolerance = 0.02
): boolean {
  if (!isAmountFilterActive(filter)) return true;
  const values = itemAmountValues(item, filter.field);
  if (!values.length) return false;

  return values.some((v) => {
    if (filter.exact != null) return Math.abs(v - filter.exact) <= tolerance;
    if (filter.min != null && v < filter.min - tolerance) return false;
    if (filter.max != null && v > filter.max + tolerance) return false;
    return filter.min != null || filter.max != null;
  });
}

export function amountFilterSummary(filter: AmountFilterState): string {
  if (!isAmountFilterActive(filter)) return '';
  const fieldLabel = filter.field === 'sell' ? 'VK' : filter.field === 'buy' ? 'EK' : 'VK/EK';
  if (filter.exact != null) return `€${filter.exact.toFixed(2)} (${fieldLabel})`;
  const parts: string[] = [];
  if (filter.min != null) parts.push(`≥€${filter.min.toFixed(2)}`);
  if (filter.max != null) parts.push(`≤€${filter.max.toFixed(2)}`);
  return `${parts.join(' ')} (${fieldLabel})`;
}
