import { describe, expect, it } from 'vitest';
import { ItemStatus, type InventoryItem } from '../types';
import {
  buildProductCardBatchJobs,
  MAX_PRODUCT_CARD_BATCH,
  partitionForCard,
  resolveProductCardBatchCount,
} from './productCardBatch';

function item(partial: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: '1',
    name: 'ASUS B550-F',
    buyPrice: 0,
    buyDate: '2026-01-01',
    category: 'Components',
    subCategory: 'Motherboards',
    status: ItemStatus.IN_STOCK,
    comment1: '',
    comment2: '',
    specs: {
      Chipset: 'B550',
      Socket: 'AM4',
      Form: 'ATX',
      RAM: 'DDR4',
      'Max RAM': '128GB',
      VRM: '12+2',
    },
    ...partial,
  };
}

describe('resolveProductCardBatchCount', () => {
  it('maps photo counts to card counts', () => {
    expect(resolveProductCardBatchCount(0)).toBe(1);
    expect(resolveProductCardBatchCount(1)).toBe(1);
    expect(resolveProductCardBatchCount(2)).toBe(2);
    expect(resolveProductCardBatchCount(3)).toBe(3);
    expect(resolveProductCardBatchCount(100)).toBe(MAX_PRODUCT_CARD_BATCH);
  });
});

describe('partitionForCard', () => {
  it('gives different items to different cards', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f'];
    const a = partitionForCard(items, 0, 3);
    const b = partitionForCard(items, 1, 3);
    const c = partitionForCard(items, 2, 3);
    expect(a).toEqual(['a', 'd']);
    expect(b).toEqual(['b', 'e']);
    expect(c).toEqual(['c', 'f']);
  });
});

describe('buildProductCardBatchJobs', () => {
  const base = {
    styleId: 'apple-studio-white',
    item: item({ hasOVP: true, hasIOShield: true }),
    accessories: { hasOVP: true, hasIOShield: true },
  };

  it('1 photo → 1 card', () => {
    const jobs = buildProductCardBatchJobs(['p1'], base);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].photos).toEqual(['p1']);
  });

  it('2 photos → 2 cards', () => {
    const jobs = buildProductCardBatchJobs(['p1', 'p2'], base);
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => j.photos[0])).toEqual(['p1', 'p2']);
  });

  it('5 photos → 3 cards from first 3', () => {
    const jobs = buildProductCardBatchJobs(['p1', 'p2', 'p3', 'p4', 'p5'], base);
    expect(jobs).toHaveLength(3);
    expect(jobs.map((j) => j.photos[0])).toEqual(['p1', 'p2', 'p3']);
  });

  it('splits accessories and varies specs/perks across cards', () => {
    const jobs = buildProductCardBatchJobs(['p1', 'p2', 'p3'], base);
    expect(jobs[0].hasOVP).toBe(true);
    expect(jobs[0].hasIOShield).toBe(false);
    expect(jobs[1].hasOVP).toBe(false);
    expect(jobs[1].hasIOShield).toBe(true);
    expect(jobs[2].hasOVP).toBe(false);
    expect(jobs[2].hasIOShield).toBe(false);

    const specKeys0 = jobs[0].specs.map((s) => s.label).join('|');
    const specKeys1 = jobs[1].specs.map((s) => s.label).join('|');
    expect(specKeys0).not.toBe(specKeys1);

    const perks0 = jobs[0].perks.join('|');
    const perks1 = jobs[1].perks.join('|');
    expect(perks0).not.toBe(perks1);
  });
});
