/**
 * Smoke test for CPU+mobo combo analytics.
 * Run: npx tsx scripts/verify-cpu-mobo-combo-analytics.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import {
  analyzeCpuMoboCombos,
  formatChipsetDisplay,
  formatCpuDisplayLabel,
  formatMoboDisplayLabel,
  suggestComboRebuys,
} from '../utils/cpuMoboComboAnalytics';

function base(partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'name'>): InventoryItem {
  return {
    category: 'Components',
    subCategory: 'Spare Parts',
    buyPrice: 0,
    buyDate: '2026-01-01',
    status: ItemStatus.IN_STOCK,
    vendor: 'Test',
    comment1: '',
    ...partial,
  };
}

const cpuA = base({
  id: 'cpu-a',
  name: 'AMD Ryzen 5 5600',
  subCategory: 'Processors',
  buyPrice: 80,
  specs: { Socket: 'AM4', Series: 'Ryzen 5', Model: '5600' },
});
const moboA = base({
  id: 'mobo-a',
  name: 'MSI B550-A PRO',
  subCategory: 'Motherboards',
  buyPrice: 70,
  specs: { Socket: 'AM4', Chipset: 'B550' },
});
const cpuB = base({
  id: 'cpu-b',
  name: 'Intel Core i5-12400',
  subCategory: 'Processors',
  buyPrice: 100,
  specs: { Socket: 'LGA 1700', Series: 'Core i5', Model: '12400' },
});
const moboB = base({
  id: 'mobo-b',
  name: 'ASUS Prime B660',
  subCategory: 'Motherboards',
  buyPrice: 90,
  specs: { Socket: 'LGA1700', Chipset: 'B660' },
});

const kitFast = base({
  id: 'kit-fast',
  name: 'AM4 Bundle Fast',
  category: 'Bundle',
  isBundle: true,
  buyPrice: 150,
  buyDate: '2026-02-01',
  sellDate: '2026-02-05',
  sellPrice: 220,
  status: ItemStatus.SOLD,
  componentIds: ['cpu-a', 'mobo-a'],
});
const kitSlow = base({
  id: 'kit-slow',
  name: 'AM4 Bundle Slow',
  category: 'Bundle',
  isBundle: true,
  buyPrice: 150,
  buyDate: '2026-01-01',
  sellDate: '2026-03-01',
  sellPrice: 200,
  status: ItemStatus.SOLD,
  componentIds: ['cpu-a', 'mobo-a'],
});
const kitIntel = base({
  id: 'kit-intel',
  name: 'Intel PC',
  category: 'PC',
  isPC: true,
  buyPrice: 190,
  buyDate: '2026-02-01',
  sellDate: '2026-02-20',
  sellPrice: 320,
  status: ItemStatus.SOLD,
  componentIds: ['cpu-b', 'mobo-b'],
});
const kitStock = base({
  id: 'kit-stock',
  name: 'AM4 Bundle Stock',
  category: 'Bundle',
  isBundle: true,
  buyPrice: 150,
  status: ItemStatus.IN_STOCK,
  componentIds: ['cpu-a', 'mobo-a'],
});

// Children sold dates for gauge avg (kit-fast / kit-slow use parent dates as fallback if kids lack sell)
const cpuASoldFast = { ...cpuA, status: ItemStatus.SOLD, sellDate: '2026-02-05', sellPrice: 100 };
const moboASoldFast = { ...moboA, status: ItemStatus.SOLD, sellDate: '2026-02-05', sellPrice: 120 };
const cpuASoldSlow = { ...cpuA, id: 'cpu-a2', status: ItemStatus.SOLD, sellDate: '2026-03-01', sellPrice: 90 };
const moboASoldSlow = {
  ...moboA,
  id: 'mobo-a2',
  status: ItemStatus.SOLD,
  sellDate: '2026-03-01',
  sellPrice: 110,
};

const items: InventoryItem[] = [
  { ...kitFast, componentIds: ['cpu-a-fast', 'mobo-a-fast'] },
  { ...cpuASoldFast, id: 'cpu-a-fast', parentContainerId: 'kit-fast' },
  { ...moboASoldFast, id: 'mobo-a-fast', parentContainerId: 'kit-fast' },
  { ...kitSlow, componentIds: ['cpu-a-slow', 'mobo-a-slow'] },
  { ...cpuASoldSlow, id: 'cpu-a-slow', buyDate: '2026-01-01', parentContainerId: 'kit-slow' },
  { ...moboASoldSlow, id: 'mobo-a-slow', buyDate: '2026-01-01', parentContainerId: 'kit-slow' },
  {
    ...kitIntel,
    componentIds: ['cpu-b-s', 'mobo-b-s'],
  },
  {
    ...cpuB,
    id: 'cpu-b-s',
    status: ItemStatus.SOLD,
    sellDate: '2026-02-20',
    sellPrice: 160,
    parentContainerId: 'kit-intel',
  },
  {
    ...moboB,
    id: 'mobo-b-s',
    status: ItemStatus.SOLD,
    sellDate: '2026-02-20',
    sellPrice: 160,
    parentContainerId: 'kit-intel',
  },
  kitStock,
  cpuA,
  moboA,
  // Orphan CPU for same AM4 combo → should suggest rebuy B550
  base({
    id: 'cpu-orphan-5600',
    name: 'AMD Ryzen 5 5600',
    subCategory: 'Processors',
    buyPrice: 80,
    status: ItemStatus.IN_STOCK,
    specs: { Socket: 'AM4', Series: 'Ryzen 5', Model: '5600' },
  }),
];

const result = analyzeCpuMoboCombos(items, 'SmallBusiness', { sort: 'eurPerDay' });

assert.ok(result.uniqueCombos >= 2, 'expected at least 2 combos');
assert.ok(result.soldKitsWithCpuMobo >= 3, 'expected 3 sold kits with pairs');

const am4 = result.rows.find((r) => r.socket.includes('AM4'));
assert.ok(am4, 'AM4 combo present');
assert.equal(am4!.soldCount, 2);
assert.equal(am4!.inStockCount, 1);
assert.ok(am4!.avgDaysToSell != null && am4!.avgDaysToSell > 0);
assert.match(am4!.cpuLabel, /Ryzen 5 5600/i);
assert.equal(am4!.moboLabel, 'B550');

const intel = result.rows.find((r) => /LGA\s?1700/i.test(r.socket));
assert.ok(intel, 'LGA 1700 combo present');
assert.equal(intel!.soldCount, 1);
assert.match(intel!.cpuLabel, /Core i5-12400/i);
assert.equal(intel!.moboLabel, 'B660');

// Compact name → pretty display
assert.equal(
  formatCpuDisplayLabel(
    base({ id: 'x', name: 'CPU ryzen33200g tray', subCategory: 'Processors' })
  ),
  'Ryzen 3 3200G'
);
assert.equal(
  formatCpuDisplayLabel(base({ id: 'y', name: 'Intel i74790', subCategory: 'Processors' })),
  'Core i7-4790'
);
assert.equal(
  formatCpuDisplayLabel(base({ id: 'z', name: 'i712700k', subCategory: 'Processors' })),
  'Core i7-12700K'
);
assert.equal(formatChipsetDisplay('Intel H97'), 'H97');
assert.equal(formatChipsetDisplay('z790'), 'Z790');
assert.equal(formatChipsetDisplay('Asus Z-97P'), 'Z97');
assert.equal(
  formatMoboDisplayLabel(
    base({
      id: 'm',
      name: 'Random board',
      subCategory: 'Motherboards',
      specs: { Chipset: 'AMD B450' },
    })
  ),
  'B450'
);

assert.ok(result.fastest, 'fastest combo set');
assert.ok(result.topProfit, 'top profit set');

const suggestions = suggestComboRebuys(items, result.rows, { limit: 8 });
assert.ok(suggestions.length >= 1, 'expected at least one rebuy/assemble suggestion');
const needMobo = suggestions.find((s) => s.need === 'mobo' && /B550/i.test(s.moboLabel));
assert.ok(needMobo, 'orphan Ryzen 5 5600 should suggest rebuying B550');
const restockIntel = suggestions.find(
  (s) => s.need === 'both' && /12400/i.test(s.cpuLabel)
);
assert.ok(restockIntel, 'sold Intel combo with no stock should suggest restock both');

console.log('verify-cpu-mobo-combo-analytics: all checks passed');
console.log(
  '  combos=',
  result.uniqueCombos,
  'sold=',
  result.soldKitsWithCpuMobo,
  'fastest=',
  result.fastest?.label,
  '€/d=',
  result.topEurPerDay?.eurPerDay?.toFixed?.(1),
  'suggestions=',
  suggestions.map((s) => s.need).join(',')
);
