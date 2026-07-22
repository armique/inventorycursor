import { describe, expect, it } from 'vitest';
import { ItemStatus, type InventoryItem } from '../types';
import {
  buildFlipSaleRecords,
  computeBuyFirstProducts,
  resolveSuggestedEbayList,
  summarizeFlipInsights,
} from './flipInsights';
import type { FlipFeeSettings } from './flipCoach';

const fees: FlipFeeSettings = { ebayFeePct: 12.5, ebayAdsPct: 17.5 };

function item(partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'name'>): InventoryItem {
  return {
    buyPrice: 100,
    buyDate: '2026-01-01',
    category: 'Components',
    subCategory: 'Graphics Cards',
    status: ItemStatus.IN_STOCK,
    comment1: '',
    comment2: '',
    ...partial,
  };
}

describe('flipInsights', () => {
  it('uses stored suggested ebay price snapshot when present', () => {
    const row = item({
      id: '1',
      name: 'RTX 3060 12GB',
      buyPrice: 100,
      suggestedEbayListPrice: 220,
      suggestedKleinListPrice: 154,
      suggestedPocketTarget: 154,
      suggestedFeePct: 30,
      suggestedCompCount: 4,
    });
    const s = resolveSuggestedEbayList(row, [row], fees);
    expect(s?.ebayList).toBe(220);
    expect(s?.fromSnapshot).toBe(true);
    expect(s?.feePct).toBe(30);
    // Klein = pocket after 30% fees (lower than eBay list)
    expect(s?.kleinList).toBeLessThan(s!.ebayList);
  });

  it('rejects below-cost bundle comps and falls back to buy × 1.25', () => {
    const bundle = item({
      id: 'bundle',
      name: 'Mixed Bundle MT-61',
      buyPrice: 61.7,
      isBundle: true,
      category: 'Bundle',
      subCategory: 'Bundle',
      // Bad saved snapshot / comps-style values below cost
      suggestedEbayListPrice: 43.11,
      suggestedKleinListPrice: 30.17,
      suggestedPocketTarget: 30.17,
      suggestedFeePct: 30,
      suggestedCompCount: 3,
    });
    const s = resolveSuggestedEbayList(bundle, [bundle], fees);
    expect(s).not.toBeNull();
    expect(s!.kleinList).toBeGreaterThanOrEqual(61.7);
    expect(s!.ebayList).toBeGreaterThan(s!.kleinList);
    // Cost fallback: 61.7 × 1.25 = 77.125 → KA 77.13, EB ≈ 110.18 at 30%
    expect(s!.kleinList).toBeCloseTo(77.13, 1);
    expect(s!.compCount).toBe(0);
  });

  it('uses child buy sum when bundle parent buy is empty', () => {
    const parent = item({
      id: 'p',
      name: 'Parts Bundle',
      buyPrice: 0,
      isBundle: true,
      category: 'Bundle',
      subCategory: 'Bundle',
    });
    const children = [
      item({ id: 'c1', name: 'RAM stick', buyPrice: 20, category: 'Components', subCategory: 'RAM' }),
      item({ id: 'c2', name: 'PSU 500W', buyPrice: 41.7, category: 'Components', subCategory: 'Power Supplies' }),
    ];
    const s = resolveSuggestedEbayList(parent, [parent, ...children], fees, children);
    expect(s).not.toBeNull();
    expect(s!.kleinList).toBeGreaterThanOrEqual(61.7);
  });

  it('summarizes flip speed and price accuracy', () => {
    const items = [
      item({
        id: 'a',
        name: 'RTX 3060 A',
        status: ItemStatus.SOLD,
        buyDate: '2026-01-01',
        sellDate: '2026-01-11',
        buyPrice: 100,
        sellPrice: 200,
        suggestedEbayListPrice: 200,
        feeAmount: 0,
      }),
      item({
        id: 'b',
        name: 'RTX 3060 B',
        status: ItemStatus.SOLD,
        buyDate: '2026-01-01',
        sellDate: '2026-01-31',
        buyPrice: 100,
        sellPrice: 180,
        suggestedEbayListPrice: 200,
        feeAmount: 0,
      }),
    ];
    const records = buildFlipSaleRecords(items);
    expect(records).toHaveLength(2);
    expect(records[0].daysToSell).toBe(10);
    const summary = summarizeFlipInsights(items);
    expect(summary.soldWithTiming).toBe(2);
    expect(summary.avgDaysToSell).toBe(20);
    expect(summary.withSuggestion).toBe(2);
    expect(summary.avgPriceAccuracyPct).toBeGreaterThan(80);
  });

  it('ranks buy-first products by profit per day', () => {
    const items = [
      item({
        id: '1',
        name: 'ASUS Dual RTX 3060 12GB',
        status: ItemStatus.SOLD,
        buyDate: '2026-01-01',
        sellDate: '2026-01-08',
        buyPrice: 120,
        sellPrice: 200,
        platformSold: 'ebay.de',
      }),
      item({
        id: '2',
        name: 'ASUS Dual RTX 3060 12GB OC',
        status: ItemStatus.SOLD,
        buyDate: '2026-02-01',
        sellDate: '2026-02-10',
        buyPrice: 125,
        sellPrice: 205,
        platformSold: 'ebay.de',
      }),
      item({
        id: '3',
        name: 'Slow HDD 1TB',
        status: ItemStatus.SOLD,
        buyDate: '2026-01-01',
        sellDate: '2026-03-15',
        buyPrice: 10,
        sellPrice: 25,
        platformSold: 'kleinanzeigen.de',
        category: 'Components',
        subCategory: 'Storage (SSD/HDD)',
      }),
      item({
        id: '4',
        name: 'Slow HDD 1TB WD',
        status: ItemStatus.SOLD,
        buyDate: '2026-01-01',
        sellDate: '2026-03-20',
        buyPrice: 12,
        sellPrice: 28,
        platformSold: 'kleinanzeigen.de',
        category: 'Components',
        subCategory: 'Storage (SSD/HDD)',
      }),
    ];
    const buyFirst = computeBuyFirstProducts(items, 5);
    expect(buyFirst.length).toBeGreaterThan(0);
    expect(buyFirst[0].avgDaysToSell).toBeLessThanOrEqual(buyFirst[buyFirst.length - 1].avgDaysToSell + 5);
    expect(buyFirst[0].advice.toLowerCase()).toMatch(/buy|restock|good/);
  });
});
