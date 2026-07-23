import { describe, expect, it } from 'vitest';
import { ItemStatus, type InventoryItem } from '../types';
import { buildItemSaleEvents } from './itemSalesPool';
import { targetMarginForDaysHeld } from './flipInsights';

function item(partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'name'>): InventoryItem {
  return {
    buyPrice: 50,
    buyDate: '2026-01-01',
    category: 'Components',
    subCategory: 'RAM',
    status: ItemStatus.IN_STOCK,
    comment1: '',
    comment2: '',
    ...partial,
  };
}

describe('itemSalesPool', () => {
  it('attributes kit sales to child parts by buy weight', () => {
    const parent = item({
      id: 'kit',
      name: 'RAM Bundle',
      isBundle: true,
      status: ItemStatus.SOLD,
      sellDate: '2026-02-01',
      sellPrice: 100,
      feeAmount: 10,
      buyPrice: 60,
      componentIds: ['a', 'b'],
      platformSold: 'ebay.de',
    });
    const a = item({
      id: 'a',
      name: 'Corsair 8GB DDR4',
      buyPrice: 20,
      status: ItemStatus.IN_COMPOSITION,
      parentContainerId: 'kit',
    });
    const b = item({
      id: 'b',
      name: 'Corsair 16GB DDR4',
      buyPrice: 40,
      status: ItemStatus.IN_COMPOSITION,
      parentContainerId: 'kit',
    });
    const events = buildItemSaleEvents([parent, a, b]);
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.source === 'bundle_attribution')).toBe(true);
    const ea = events.find((e) => e.partItemId === 'a')!;
    const eb = events.find((e) => e.partItemId === 'b')!;
    expect(ea.allocatedSell).toBeCloseTo(100 / 3, 1);
    expect(eb.allocatedSell).toBeCloseTo(200 / 3, 1);
    expect(ea.modelKey.length).toBeGreaterThan(0);
  });

  it('records standalone leaf sales without using bundle titles', () => {
    const sold = item({
      id: 'gpu',
      name: 'GTX 1660 Super',
      status: ItemStatus.SOLD,
      buyDate: '2026-01-01',
      sellDate: '2026-01-20',
      buyPrice: 80,
      sellPrice: 140,
      feeAmount: 0,
      platformSold: 'kleinanzeigen.de',
    });
    const kit = item({
      id: 'kit',
      name: 'PC Bundle Mega',
      isBundle: true,
      status: ItemStatus.SOLD,
      sellDate: '2026-01-20',
      sellPrice: 500,
    });
    const events = buildItemSaleEvents([sold, kit]);
    expect(events).toHaveLength(1);
    expect(events[0].partItemId).toBe('gpu');
    expect(events[0].source).toBe('standalone');
    expect(events[0].marginPct).toBeCloseTo(75, 0);
  });
});

describe('margin decay schedule', () => {
  it('hits 30% by day 12', () => {
    expect(targetMarginForDaysHeld(0)).toBe(0.6);
    expect(targetMarginForDaysHeld(12)).toBe(0.3);
  });
});
