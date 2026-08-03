/**
 * Guard test for Bulk Import (Task 10: "already works as needed — do not touch").
 *
 * The AI-tracking work adds fields to InventoryItem and reroutes the Purchases tab, both
 * of which sit close to bulk entry. This pins the cost-split behaviour so any accidental
 * change there fails loudly instead of quietly reshuffling purchase prices.
 * Run: npx tsx scripts/verify-bulk-import-unchanged.ts
 */
import assert from 'node:assert/strict';
import {
  estimateBulkItemWeight,
  splitBulkImportCosts,
  type BulkCostSplitInput,
} from '../utils/bulkImportCostSplit';
import { lineHasDefectKeyword, pickBulkImportDisplayName, resolveDefectCounts, stripConditionAnnotations } from '../utils/bulkTextParse';

function sum(map: Record<string, number>): number {
  return Math.round(Object.values(map).reduce((s, v) => s + v, 0) * 100) / 100;
}

// --- EQUAL split distributes to the cent, with the remainder on the first rows ---
{
  const items: BulkCostSplitInput[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const split = splitBulkImportCosts(items, 100, 'EQUAL');
  assert.deepEqual(split, { a: 33.34, b: 33.33, c: 33.33 });
  assert.equal(sum(split), 100, 'no cent is lost');
}

// --- SMART split weights by category and keeps the total exact ---
{
  const items: BulkCostSplitInput[] = [
    { id: 'gpu', subCategory: 'Graphics Cards', name: 'RTX 3060' },
    { id: 'psu', subCategory: 'Power Supplies', name: 'be quiet 550W' },
    { id: 'case', subCategory: 'Cases', name: 'Fractal Define' },
  ];
  const split = splitBulkImportCosts(items, 300, 'SMART');
  assert.equal(sum(split), 300);
  assert.ok(split.gpu > split.psu, 'a GPU carries more of the price than a PSU');
  assert.ok(split.psu > split.case);
}

// --- manual (locked) costs are respected and the rest splits over what is left ---
{
  const items: BulkCostSplitInput[] = [
    { id: 'a', manualCost: 50 },
    { id: 'b' },
    { id: 'c' },
  ];
  const split = splitBulkImportCosts(items, 100, 'EQUAL');
  assert.equal(split.a, 50);
  assert.equal(split.b, 25);
  assert.equal(split.c, 25);
  assert.equal(sum(split), 100);
}

// --- manual costs above the total leave nothing to split, never negatives ---
{
  const split = splitBulkImportCosts([{ id: 'a', manualCost: 200 }, { id: 'b' }], 100, 'SMART');
  assert.equal(split.a, 200);
  assert.equal(split.b, 0);
}

// --- defective parts are weighted down ---
{
  const healthy = estimateBulkItemWeight({ id: 'x', subCategory: 'Graphics Cards' });
  const broken = estimateBulkItemWeight({ id: 'y', subCategory: 'Graphics Cards', isDefective: true });
  assert.ok(broken < healthy);
  assert.ok(estimateBulkItemWeight({ id: 'z' }) >= 0.3, 'weights never collapse to zero');
}

// --- edge cases stay well-defined ---
assert.deepEqual(splitBulkImportCosts([], 100, 'SMART'), {});
assert.deepEqual(splitBulkImportCosts([{ id: 'a' }], 0, 'SMART'), { a: 0 });
assert.deepEqual(splitBulkImportCosts([{ id: 'a' }], -5, 'EQUAL'), { a: 0 });

// --- the "paste as is" text helpers still classify condition annotations ---
{
  assert.equal(lineHasDefectKeyword('RTX 3060 defekt'), true);
  assert.equal(lineHasDefectKeyword('RTX 3060 12GB'), false);
  // Only counted annotations are stripped — a bare "(defekt)" stays part of the name.
  assert.equal(stripConditionAnnotations('RAM 8GB (3 working, 1 defekt)'), 'RAM 8GB');
  assert.equal(stripConditionAnnotations('RTX 3060 (defekt)'), 'RTX 3060 (defekt)');

  assert.deepEqual(resolveDefectCounts(4, 'RAM 8GB 3 working, 1 defekt'), { working: 3, defective: 1 });
  assert.deepEqual(resolveDefectCounts(2, 'RTX 3060 12GB'), { working: 2, defective: 0 });
  assert.deepEqual(resolveDefectCounts(2, 'RTX 3060 defekt'), { working: 0, defective: 2 });
  assert.deepEqual(resolveDefectCounts(1, 'RTX 3060 12GB', true), { working: 0, defective: 1 });
}

// --- AI parse prefers cleaned titles; As-Is keeps paste; RAM kit format wins ---
{
  assert.equal(
    pickBulkImportDisplayName({
      mode: 'AI',
      pasteProductName: 'msi rtx 3060 gaming x 12gb neu!!!',
      aiName: 'MSI GeForce RTX 3060 Gaming X 12GB',
    }),
    'MSI GeForce RTX 3060 Gaming X 12GB'
  );
  assert.equal(
    pickBulkImportDisplayName({
      mode: 'AS_IS',
      pasteProductName: 'msi rtx 3060 gaming x 12gb neu!!!',
      aiName: 'MSI GeForce RTX 3060 Gaming X 12GB',
    }),
    'msi rtx 3060 gaming x 12gb neu!!!'
  );
  assert.equal(
    pickBulkImportDisplayName({
      mode: 'AI',
      pasteProductName: 'ACR24D4U1S1ME-8X 8GB',
      aiName: '64GB (8x8GB) DDR4',
      ramFormattedName: 'Crucial 8GB (1x8GB) DDR4 RAM',
    }),
    'Crucial 8GB (1x8GB) DDR4 RAM'
  );
}

console.log('verify-bulk-import-unchanged: ok');
