/**
 * Verify bulk category inference — displays must not land on Graphics Cards.
 * Run: npx tsx scripts/verify-bulk-category-infer.ts
 */
import assert from 'node:assert/strict';
import { DEFAULT_CATEGORIES } from '../services/constants';
import {
  clampToLiveCategories,
  inferCategoryFromName,
  looksLikeDisplayOrMonitor,
  looksLikeGpu,
  reconcileBulkCategory,
} from '../utils/bulkCategoryInfer';

const DEFAULT_TREE = { ...DEFAULT_CATEGORIES };

const NO_DISPLAYS_TREE: Record<string, string[]> = {
  ...DEFAULT_TREE,
  Components: [...DEFAULT_TREE.Components],
  Peripherals: DEFAULT_TREE.Peripherals.filter((s) => s !== 'Monitors'),
};

const created: Array<{ category: string; sub?: string }> = [];
function trackAdd(category: string, sub?: string) {
  created.push({ category, sub });
}

// --- display detection ---
assert.equal(looksLikeDisplayOrMonitor('LG UltraGear 27GP850 27" 165Hz Nano IPS'), true);
assert.equal(looksLikeDisplayOrMonitor('Samsung Odyssey G7 32" Curved Monitor'), true);
assert.equal(looksLikeGpu('LG UltraGear 27" 165Hz'), false);
assert.equal(looksLikeGpu('MSI GeForce RTX 3060 Gaming X 12GB'), true);

// --- infer intent ---
assert.equal(inferCategoryFromName('Dell U2723QE 27 inch 4K Monitor').subCategory, 'Displays');
assert.equal(inferCategoryFromName('ASUS ROG Swift PG279QM 240Hz').subCategory, 'Displays');
assert.equal(inferCategoryFromName('Palit GeForce RTX 4060 8GB').subCategory, 'Graphics Cards');

// --- missing Displays sub must be created, not mapped to Graphics Cards ---
{
  created.length = 0;
  const rec = reconcileBulkCategory(
    'LG 27GP850-B 27" 165Hz Nano IPS Gaming Monitor',
    'Components',
    'Displays',
    NO_DISPLAYS_TREE,
    trackAdd
  );
  assert.equal(rec.category, 'Components');
  assert.equal(rec.subCategory, 'Displays');
  assert.notEqual(rec.subCategory, 'Graphics Cards');
  assert.ok(created.some((c) => c.category === 'Components' && c.sub === 'Displays'));
}

// --- AI mislabel as GPU should be corrected for monitors ---
{
  created.length = 0;
  const rec = reconcileBulkCategory(
    'AOC 24G2U 24" 144Hz IPS',
    'Components',
    'Graphics Cards',
    NO_DISPLAYS_TREE,
    trackAdd
  );
  assert.equal(rec.subCategory, 'Displays');
  assert.notEqual(rec.subCategory, 'Graphics Cards');
}

// --- existing Monitors under Peripherals is preferred when present ---
{
  const rec = reconcileBulkCategory(
    'BenQ MOBIUZ EX2710S 27"',
    'Components',
    'Displays',
    DEFAULT_TREE
  );
  assert.equal(rec.category, 'Peripherals');
  assert.equal(rec.subCategory, 'Monitors');
}

// --- clamp creates missing subs instead of falling back to first option ---
{
  created.length = 0;
  const rec = clampToLiveCategories(
    { category: 'Components', subCategory: 'Displays' },
    NO_DISPLAYS_TREE,
    trackAdd
  );
  assert.equal(rec.subCategory, 'Displays');
  assert.ok(created.some((c) => c.sub === 'Displays'));
}

// --- CPUs stay Processors ---
{
  const rec = reconcileBulkCategory('Intel Core i7-12700K', 'Components', 'Graphics Cards', DEFAULT_TREE);
  assert.equal(rec.subCategory, 'Processors');
}

console.log('verify-bulk-category-infer: all checks passed');
