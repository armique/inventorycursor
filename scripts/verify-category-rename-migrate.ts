/**
 * Renaming Graphics Cards → GPU must remaps inventory rows, not just the Settings catalog.
 * Run: npx tsx scripts/verify-category-rename-migrate.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import {
  migrateLegacyGpuSubcategoryNames,
  renameSubcategoryInCatalog,
} from '../utils/categoryRename';
import { matchesInventoryCategoryPin } from '../services/financialAggregation';

function item(partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'name'>): InventoryItem {
  return {
    buyPrice: 0,
    sellPrice: 0,
    status: ItemStatus.SOLD,
    category: 'Components',
    subCategory: 'Graphics Cards',
    buyDate: '2026-01-01',
    ...partial,
  } as InventoryItem;
}

const items: InventoryItem[] = [
  item({ id: 'g1', name: 'RTX 5070', subCategory: 'Graphics Cards' }),
  item({ id: 'g2', name: 'RTX 3060', subCategory: 'Graphic Cards' }),
  item({ id: 'c1', name: 'i7', subCategory: 'Processors' }),
];

const renamed = renameSubcategoryInCatalog(
  {
    categories: { Components: ['Graphics Cards', 'Processors'] },
    categoryFields: { 'Components:Graphics Cards': ['VRAM'] },
    items,
  },
  'Components',
  'Graphics Cards',
  'GPU'
);

assert.equal(renamed.movedCount, 1);
assert.ok(renamed.categories.Components.includes('GPU'));
assert.ok(!renamed.categories.Components.includes('Graphics Cards'));
assert.equal(renamed.items.find((i) => i.id === 'g1')!.subCategory, 'GPU');
assert.deepEqual(renamed.categoryFields['Components:GPU'], ['VRAM']);
assert.equal(
  matchesInventoryCategoryPin(renamed.items.find((i) => i.id === 'g1')!, 'Components', 'GPU'),
  true
);

const migrated = migrateLegacyGpuSubcategoryNames({
  categories: { Components: ['GPU', 'Graphic Cards', 'Processors'] },
  categoryFields: { 'Components:Graphic Cards': ['VRAM'] },
  items: renamed.items,
});
assert.ok(migrated.changed);
assert.equal(migrated.items.find((i) => i.id === 'g2')!.subCategory, 'GPU');
assert.ok(!migrated.categories.Components.includes('Graphic Cards'));
assert.equal(
  matchesInventoryCategoryPin(
    { category: 'Components', subCategory: 'Graphics Cards' },
    'Components',
    'GPU'
  ),
  true,
  'alias match still works for any leftover legacy rows'
);

console.log('OK: subcategory rename remaps inventory; legacy GPU aliases migrate to GPU');
console.log('\nAll category rename migration checks passed.');
