import { describe, expect, it } from 'vitest';
import { ItemStatus, type InventoryItem } from '../types';
import {
  buildFlipSaleRecords,
  computeBuyFirstProducts,
  resolveSuggestedEbayList,
  roundListPriceUp,
  summarizeFlipInsights,
  targetMarginForDaysHeld,
  daysHeldFromBuyDate,
} from './flipInsights';
import type { FlipFeeSettings } from './flipCoach';

const fees: FlipFeeSettings = { ebayFeePct: 12.5, ebayAdsPct: 12.5 };

/** Buy date = today so age target stays at 60%. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function item(partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'name'>): InventoryItem {
  return {
    buyPrice: 100,
    buyDate: todayIso(),
    category: 'Components',
    subCategory: 'Graphics Cards',
    status: ItemStatus.IN_STOCK,
    comment1: '',
    comment2: '',
    ...partial,
  };
}

describe('flipInsights', () => {
  it('decays margin −5pp every 2 days from 60% to 30%', () => {
    expect(targetMarginForDaysHeld(0)).toBe(0.6);
    expect(targetMarginForDaysHeld(1)).toBe(0.6);
    expect(targetMarginForDaysHeld(2)).toBe(0.55);
    expect(targetMarginForDaysHeld(4)).toBe(0.5);
    expect(targetMarginForDaysHeld(6)).toBe(0.45);
    expect(targetMarginForDaysHeld(12)).toBe(0.3);
    expect(targetMarginForDaysHeld(99)).toBe(0.3);
  });

  it('uses stored suggested ebay price snapshot when present', () => {
    const row = item({
      id: '1',
      name: 'RTX 3060 12GB',
      buyPrice: 100,
      // Day 12+ → 30% floor; 154 pocket is within [130, 160]
      buyDate: daysAgoIso(14),
      suggestedEbayListPrice: 220,
      suggestedKleinListPrice: 154,
      suggestedPocketTarget: 154,
      suggestedFeePct: 25,
      suggestedCompCount: 4,
    });
    const s = resolveSuggestedEbayList(row, [row], fees);
    // Snapshot kept, then rounded up to clean €5 steps
    expect(s?.kleinList).toBe(155);
    expect(s?.ebayList).toBe(220);
    expect(s?.fromSnapshot).toBe(true);
    expect(s?.feePct).toBe(25);
    expect(s?.kleinList).toBeLessThan(s!.ebayList);
  });

  it('rejects fat comps on a cheap bundle and falls back to age target (day 0 = 60%)', () => {
    const bundle = item({
      id: 'kit',
      name: 'PC Bundle · MSI B450M · Ryzen 3 3100 · 16GB',
      buyPrice: 48.29,
      buyDate: todayIso(),
      isBundle: true,
      category: 'Bundle',
      suggestedEbayListPrice: 195,
      suggestedKleinListPrice: 140,
      suggestedPocketTarget: 140,
      suggestedFeePct: 25,
      suggestedCompCount: 4,
    });
    const s = resolveSuggestedEbayList(bundle, [bundle], fees);
    expect(s).not.toBeNull();
    // 48.29 × 1.60 ≈ 77.26 → KA €80, EB 80/0.75 ≈ 106.67 → €110
    expect(s!.kleinList).toBe(80);
    expect(s!.ebayList).toBe(110);
    expect(s!.targetMargin).toBe(0.6);
  });

  it('rejects thin-margin comps and falls back to age target (day 6 = 45%)', () => {
    const bundle = item({
      id: 'bundle',
      name: 'Mixed Bundle MT-61',
      buyPrice: 61.7,
      buyDate: daysAgoIso(6),
      isBundle: true,
      category: 'Bundle',
      subCategory: 'Bundle',
      // Bad saved snapshot / comps-style values below age target
      suggestedEbayListPrice: 43.11,
      suggestedKleinListPrice: 30.17,
      suggestedPocketTarget: 30.17,
      suggestedFeePct: 25,
      suggestedCompCount: 3,
    });
    const s = resolveSuggestedEbayList(bundle, [bundle], fees);
    expect(s).not.toBeNull();
    // Day 6 → 45%; 61.7 × 1.45 ≈ 89.47 → KA €90; EB 90/0.75 = 120
    expect(s!.kleinList).toBe(90);
    expect(s!.ebayList).toBe(120);
    expect(s!.compCount).toBe(0);
    expect(s!.targetMargin).toBe(0.45);
  });

  it('uses child buy sum when bundle parent buy is empty', () => {
    const parent = item({
      id: 'p',
      name: 'Parts Bundle',
      buyPrice: 0,
      isBundle: true,
      category: 'Bundle',
      subCategory: 'Bundle',
      buyDate: daysAgoIso(12),
    });
    const children = [
      item({ id: 'c1', name: 'RAM stick', buyPrice: 20, category: 'Components', subCategory: 'RAM' }),
      item({ id: 'c2', name: 'PSU 500W', buyPrice: 41.7, category: 'Components', subCategory: 'Power Supplies' }),
    ];
    const s = resolveSuggestedEbayList(parent, [parent, ...children], fees, children);
    expect(s).not.toBeNull();
    // Parent day 12 → 30% floor on 61.7 cost
    expect(s!.kleinList).toBeGreaterThanOrEqual(Math.ceil(61.7 * 1.3));
  });

  it('rounds list prices up to clean euro steps', () => {
    expect(roundListPriceUp(32.1)).toBe(35);
    expect(roundListPriceUp(47)).toBe(50);
    expect(roundListPriceUp(89.5)).toBe(90);
  });

  it('computes days held from buy date', () => {
    expect(daysHeldFromBuyDate(daysAgoIso(0))).toBeLessThanOrEqual(1);
    expect(daysHeldFromBuyDate(daysAgoIso(5))).toBeGreaterThanOrEqual(4);
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
