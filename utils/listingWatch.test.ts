import { describe, expect, it } from 'vitest';
import { ItemStatus, type InventoryItem } from '../types';
import {
  computePriceAnalyzer,
  computePriceChangeHint,
  isListingWatchCandidate,
  isSaleReadyUnlisted,
} from './listingWatch';
import { parseKaTitlesPaste, parseEuroPrice } from './listingPresence';

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
  it('ignores defective and non-ready stock', () => {
    expect(isListingWatchCandidate(item({ id: '1', name: 'GPU', isDefective: true }))).toBe(false);
    expect(isListingWatchCandidate(item({ id: '2', name: 'GPU' }))).toBe(false);
    expect(isListingWatchCandidate(item({ id: '3', name: 'GPU', saleReady: true }))).toBe(true);
  });

  it('flags sale-ready unlisted', () => {
    expect(
      isSaleReadyUnlisted(item({ id: '1', name: 'GPU', saleReady: true }))
    ).toBe(true);
    expect(
      isSaleReadyUnlisted(
        item({ id: '2', name: 'GPU', saleReady: true, listedOnEbay: true })
      )
    ).toBe(false);
  });

  it('hints when live ask is above suggest', () => {
    const row = item({
      id: '1',
      name: 'RTX 3060',
      saleReady: true,
      buyPrice: 100,
      listedOnEbay: true,
      liveEbayListPrice: 220,
    });
    const hint = computePriceChangeHint(row, {
      ebayList: 160,
      kleinList: 120,
      pocketTarget: 120,
      feePct: 25,
      compCount: 0,
      fromSnapshot: false,
      targetMargin: 0.45,
      daysHeld: 6,
    });
    expect(hint).not.toBeNull();
    expect(hint!.deltaEur).toBeGreaterThan(0);
    expect(hint!.label.toLowerCase()).toContain('drop');
  });

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
  });
});

describe('parseKaTitlesPaste', () => {
  it('parses title | price | url', () => {
    const rows = parseKaTitlesPaste('Corsair 16GB | 45 | https://www.kleinanzeigen.de/s-anzeige/x');
    expect(rows[0].title).toContain('Corsair');
    expect(rows[0].price).toBe(45);
    expect(rows[0].url).toContain('kleinanzeigen');
  });

  it('parses euro strings', () => {
    expect(parseEuroPrice('€49,00')).toBe(49);
    expect(parseEuroPrice('1.234,50')).toBe(1234.5);
  });
});
