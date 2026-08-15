/**
 * Verify 3D print cost calculator formulas (spec test cases 1–4).
 * Run: npx tsx scripts/verify-three-d-print-calculator.ts
 */
import assert from 'node:assert/strict';
import { DEFAULT_MATERIALS, DEFAULT_THREE_D_PRINT_SETTINGS, normalizeThreeDPrintSettings } from '../services/threeDPrintDefaults';
import { applyPrintStage, nextPrintStage, resolvePrintStage } from '../utils/printQueue';
import { ItemStatus, type InventoryItem } from '../types';
import { calculateThreeDPrintQuote, formatPrintTimeDisplay } from '../utils/threeDPrintCalculator';

const defaults = {
  ...DEFAULT_THREE_D_PRINT_SETTINGS,
  materials: [...DEFAULT_THREE_D_PRINT_SETTINGS.materials],
  quantityDiscountTiers: [...DEFAULT_THREE_D_PRINT_SETTINGS.quantityDiscountTiers],
};

function baseInput(overrides: Partial<Parameters<typeof calculateThreeDPrintQuote>[0]> = {}) {
  return {
    weightG: 100,
    printTimeHours: 4,
    quantity: 1,
    filamentPricePerKg: 13,
    ...overrides,
  };
}

// Test 1 — defaults, min order floor
{
  const q = calculateThreeDPrintQuote(baseInput(), defaults);
  assert.equal(q.valid, true);
  assert.equal(q.materialCostWithWaste, 1.43);
  assert.equal(q.electricityCost, 0.13);
  assert.equal(q.depreciationCost, 0.32);
  assert.equal(q.additionalCost, 0.3);
  assert.equal(q.productionCostPerPart, 2.18);
  assert.equal(q.pricePerPart, 4.36);
  assert.equal(q.finalPrice, 10);
  assert.equal(q.minimumOrderAdjustment, 5.64);
  assert.equal(formatPrintTimeDisplay(3.5), '3 h 30 min');
}

// Test 2 — heavier + longer print increases price via material AND machine time
{
  const light = calculateThreeDPrintQuote(baseInput({ weightG: 100, printTimeHours: 1 }), defaults);
  const heavy = calculateThreeDPrintQuote(baseInput({ weightG: 500, printTimeHours: 10 }), defaults);
  assert.ok(heavy.productionCostPerPart > light.productionCostPerPart);
  assert.ok(heavy.materialCostWithWaste > light.materialCostWithWaste);
  assert.ok(heavy.electricityCost > light.electricityCost);
  assert.ok(heavy.depreciationCost > light.depreciationCost);
  assert.ok(heavy.finalPrice > light.finalPrice);
}

// Test 3 — small order hits minimum price
{
  const q = calculateThreeDPrintQuote(baseInput({ weightG: 50, printTimeHours: 2 }), defaults);
  assert.equal(q.valid, true);
  assert.ok(q.subtotalAfterDiscount < 10);
  assert.equal(q.finalPrice, 10);
  assert.ok(q.minimumOrderAdjustment > 0);
}

// Test 4 — quantity 10 gets 10% discount, min order not applied when subtotal is high enough
{
  const q = calculateThreeDPrintQuote(baseInput({ quantity: 10 }), defaults);
  assert.equal(q.quantity, 10);
  assert.equal(q.discountPct, 10);
  assert.ok(q.subtotalBeforeDiscount > 10);
  assert.ok(q.discountAmount > 0);
  assert.equal(q.finalPrice, q.subtotalAfterDiscount);
  assert.equal(q.minimumOrderAdjustment, 0);
}

{
  const keys = DEFAULT_MATERIALS.map((m) => m.key);
  assert.deepEqual(keys, ['PLA', 'PETG', 'ABS', 'ASA', 'TPU']);
  const merged = normalizeThreeDPrintSettings({ materials: [{ key: 'PLA', label: 'PLA', pricePerKg: 15 }] });
  assert.equal(merged.materials.find((m) => m.key === 'PLA')?.pricePerKg, 15);
  assert.ok(merged.materials.some((m) => m.key === 'PETG'));
  assert.ok(merged.materials.some((m) => m.key === 'TPU'));
}

{
  const item = {
    id: 'p1',
    name: 'Bracket',
    buyPrice: 2,
    buyDate: '2026-01-01',
    category: 'Misc',
    status: ItemStatus.IN_STOCK,
    comment1: '',
    comment2: '',
    specs: { 'Production Method': '3D Printed', 'Filament Weight': '100g', 'Print Time': '4 h' },
  } as InventoryItem;
  assert.equal(resolvePrintStage(item), 'queued');
  assert.equal(nextPrintStage('queued'), 'printing');
  assert.equal(nextPrintStage('printing'), 'ready');
  assert.equal(nextPrintStage('ready'), 'sold');
  const sold = applyPrintStage(item, 'sold');
  assert.equal(sold.printStage, 'sold');
  assert.equal(sold.status, ItemStatus.SOLD);
}

console.log('verify-three-d-print-calculator: all checks passed');
