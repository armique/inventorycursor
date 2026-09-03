import { describe, expect, it } from 'vitest';
import { ItemStatus, type InventoryItem } from '../types';
import { computePriceAnalyzer } from './listingWatch';

function item(partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'name'>): InventoryItem {
  return {
    buyPrice: 50,
    buyDate: new Date().toISOString().slice(0, 10),
    category: 'Components',
    subCategory: 'RAM',
    status: ItemStatus.IN_STOCK,
    comment1: '',
    comment2: '',
    ...partial,
  };
}

describe('listingWatch', () => {
  it('analyzer shows DROP / List from age + buy', () => {
    const row = item({
      id: '1',
      name: 'PC Bundle',
      buyPrice: 48,
      buyDate: new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10),
      listedOnKleinanzeigen: true,
      liveKleinListPrice: 130,
    });
    const a = computePriceAnalyzer(row);
    expect(a).not.toBeNull();
    expect(a!.daysHeld).toBeGreaterThanOrEqual(5);
    expect(a!.channels.some((c) => c.channel === 'KA' && c.action === 'drop')).toBe(true);
    expect(a!.channels.some((c) => c.channel === 'EB' && c.action === 'list')).toBe(true);
    expect(a!.minMarginPct).toBe(30);
    expect(a!.minKlein).toBeGreaterThanOrEqual(Math.round(48 * 1.3));
    expect(a!.minEbay).toBeGreaterThanOrEqual(a!.minKlein);
    expect(a!.minLabel).toMatch(/Min 30%/);
  });
});
