import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import { groupSalesByVariant } from '../utils/reinvestAnalysis';

function mkItem(overrides: Partial<InventoryItem>): InventoryItem {
  return {
    id: overrides.id || `i-${Math.random()}`,
    name: overrides.name || 'Part',
    category: overrides.category || 'Components',
    subCategory: overrides.subCategory || 'Graphics Cards',
    status: overrides.status || ItemStatus.IN_STOCK,
    buyPrice: overrides.buyPrice ?? 100,
    buyDate: overrides.buyDate || '2026-01-01',
    comment1: '',
    comment2: '',
    ...overrides,
  };
}

const childA = mkItem({
  id: 'child-a',
  name: 'RTX 3070',
  status: ItemStatus.IN_COMPOSITION,
  buyPrice: 240,
  sellPrice: 620,
  sellDate: '2026-07-20',
});
const childB = mkItem({
  id: 'child-b',
  name: 'Ryzen 5600X',
  category: 'Processors',
  subCategory: 'Processors',
  status: ItemStatus.IN_COMPOSITION,
  buyPrice: 100,
  sellPrice: 210,
  sellDate: '2026-07-20',
});
const soldPc = mkItem({
  id: 'pc-1',
  name: 'Gaming PC',
  category: 'PC',
  isPC: true,
  isBundle: true,
  status: ItemStatus.SOLD,
  buyPrice: 340,
  sellPrice: 830,
  sellDate: '2026-07-20',
  componentIds: ['child-a', 'child-b'],
});

const buckets = groupSalesByVariant([soldPc, childA, childB]);
assert.ok(buckets.size >= 2, 'sold container child components should feed variant groups');

console.log('verify-reinvest-retro-children: ok');

