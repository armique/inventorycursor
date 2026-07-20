import { describe, expect, it } from 'vitest';
import { ItemStatus, type InventoryItem } from '../types';
import {
  isMotherboardLike,
  resolveProductCardAccessoryHints,
} from './itemAccessories';

function baseItem(partial: Partial<InventoryItem>): InventoryItem {
  return {
    id: 'x',
    name: 'Item',
    buyPrice: 0,
    buyDate: '2026-01-01',
    category: 'Components',
    status: ItemStatus.IN_STOCK,
    comment1: '',
    comment2: '',
    ...partial,
  };
}

describe('isMotherboardLike', () => {
  it('detects motherboard subcategory', () => {
    expect(
      isMotherboardLike({ category: 'Components', subCategory: 'Motherboards', name: 'ASUS B550' })
    ).toBe(true);
  });

  it('detects mainboard in name', () => {
    expect(isMotherboardLike({ category: 'Components', name: 'MSI B450 Mainboard' })).toBe(true);
  });

  it('is false for GPUs and containers', () => {
    expect(
      isMotherboardLike({ category: 'Components', subCategory: 'Graphics Cards', name: 'RTX 3070' })
    ).toBe(false);
    expect(isMotherboardLike({ category: 'Bundle', isBundle: true, name: 'Bundle' })).toBe(false);
  });
});

describe('resolveProductCardAccessoryHints', () => {
  it('uses item flags for singles', () => {
    const item = baseItem({ hasOVP: true, hasIOShield: true, subCategory: 'Motherboards' });
    expect(resolveProductCardAccessoryHints(item)).toEqual({ hasOVP: true, hasIOShield: true });
  });

  it('ORs parent + children for bundles', () => {
    const mobo = baseItem({
      id: 'mobo',
      name: 'ASUS B550',
      subCategory: 'Motherboards',
      hasIOShield: true,
      parentContainerId: 'bundle',
      status: ItemStatus.IN_COMPOSITION,
    });
    const gpu = baseItem({
      id: 'gpu',
      name: 'RTX 3070',
      subCategory: 'Graphics Cards',
      hasOVP: true,
      parentContainerId: 'bundle',
      status: ItemStatus.IN_COMPOSITION,
    });
    const bundle = baseItem({
      id: 'bundle',
      name: 'PC Bundle',
      category: 'Mixed Bundle',
      isBundle: true,
      componentIds: ['mobo', 'gpu'],
    });
    expect(resolveProductCardAccessoryHints(bundle, [bundle, mobo, gpu])).toEqual({
      hasOVP: true,
      hasIOShield: true,
    });
  });
});
