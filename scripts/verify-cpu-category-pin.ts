/**
 * CPU quick pin must match both Processors and CPU rows (and top-level Processors).
 * Run: npx tsx scripts/verify-cpu-category-pin.ts
 */
import assert from 'node:assert/strict';
import {
  inventorySubcategoryAliasesMatch,
  matchesInventoryCategoryPin,
} from '../services/financialAggregation';

assert.equal(inventorySubcategoryAliasesMatch('CPU', 'Processors'), true);
assert.equal(inventorySubcategoryAliasesMatch('Processors', 'CPU'), true);
assert.equal(inventorySubcategoryAliasesMatch('Prozessor', 'CPU'), true);
assert.equal(inventorySubcategoryAliasesMatch('CPU', 'GPU'), false);

assert.equal(
  matchesInventoryCategoryPin(
    { category: 'Components', subCategory: 'Processors' },
    'Components',
    'CPU'
  ),
  true,
  'pin CPU must include Processors rows'
);
assert.equal(
  matchesInventoryCategoryPin(
    { category: 'Components', subCategory: 'CPU' },
    'Components',
    'Processors'
  ),
  true,
  'pin Processors must include CPU rows'
);
assert.equal(
  matchesInventoryCategoryPin({ category: 'Processors', subCategory: '' }, 'Components', 'CPU'),
  true,
  'top-level Processors category matches CPU pin'
);
assert.equal(
  matchesInventoryCategoryPin(
    { category: 'Components', subCategory: 'GPU' },
    'Components',
    'CPU'
  ),
  false
);

console.log('OK: CPU ↔ Processors category pin aliases');
console.log('\nAll CPU category pin checks passed.');
