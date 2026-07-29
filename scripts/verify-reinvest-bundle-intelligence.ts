import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import { findAnchorBundles } from '../utils/reinvestAnalysis';

function item(overrides: Partial<InventoryItem>): InventoryItem {
  return {
    id: overrides.id || `i-${Math.random()}`,
    name: overrides.name || 'Part',
    category: overrides.category || 'Components',
    subCategory: overrides.subCategory || 'Processors',
    status: overrides.status || ItemStatus.SOLD,
    buyPrice: overrides.buyPrice ?? 100,
    sellPrice: overrides.sellPrice ?? 200,
    buyDate: overrides.buyDate || '2026-01-01',
    sellDate: overrides.sellDate || '2026-07-20',
    comment1: '',
    comment2: '',
    ...overrides,
  };
}

function soldBundle(id: string, name: string, componentIds: string[], sellPrice: number): InventoryItem {
  return item({
    id,
    name,
    category: 'Bundle',
    isBundle: true,
    isPC: false,
    componentIds,
    sellPrice,
    status: ItemStatus.SOLD,
  });
}

const c1 = item({ id: 'cpu1', name: 'Intel Core i7-4790K', category: 'Processors', subCategory: 'Processors', status: ItemStatus.IN_COMPOSITION });
const m1 = item({ id: 'mobo1', name: 'ASUS Z97 Motherboard', category: 'Components', subCategory: 'Motherboards', status: ItemStatus.IN_COMPOSITION });
const c2 = item({ id: 'cpu2', name: 'Intel Core i7-4790K', category: 'Processors', subCategory: 'Processors', status: ItemStatus.IN_COMPOSITION });
const m2 = item({ id: 'mobo2', name: 'MSI H97 Mainboard', category: 'Components', subCategory: 'Motherboards', status: ItemStatus.IN_COMPOSITION });

const r1 = item({ id: 'cpu3', name: 'Ryzen 5 5600', category: 'Processors', subCategory: 'Processors', status: ItemStatus.IN_COMPOSITION });
const rm1 = item({ id: 'am4-1', name: 'B550 Motherboard', category: 'Components', subCategory: 'Motherboards', status: ItemStatus.IN_COMPOSITION });
const r2 = item({ id: 'cpu4', name: 'Ryzen 5 5600', category: 'Processors', subCategory: 'Processors', status: ItemStatus.IN_COMPOSITION });
const rm2 = item({ id: 'am4-2', name: 'B450 Mainboard', category: 'Components', subCategory: 'Motherboards', status: ItemStatus.IN_COMPOSITION });

const bundles = [
  soldBundle('b1', 'Intel bundle A', ['cpu1', 'mobo1'], 260),
  soldBundle('b2', 'Intel bundle B', ['cpu2', 'mobo2'], 250),
  soldBundle('b3', 'AM4 bundle A', ['cpu3', 'am4-1'], 290),
  soldBundle('b4', 'AM4 bundle B', ['cpu4', 'am4-2'], 300),
];

const rows = findAnchorBundles([c1, m1, c2, m2, r1, rm1, r2, rm2, ...bundles], false);
assert.ok(rows.some((g) => /4790k/i.test(g.label)), 'expects CPU-centric bundle group for 4790K');
assert.ok(rows.some((g) => /amd am4 bundle/i.test(g.label)), 'expects AMD AM4 bundle grouping');

console.log('verify-reinvest-bundle-intelligence: ok');

