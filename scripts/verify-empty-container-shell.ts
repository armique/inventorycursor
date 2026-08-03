/**
 * Empty PC/bundle shells (all children sold/removed) must leave inventory.
 * Run: npx tsx scripts/verify-empty-container-shell.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import { findEmptyContainerShellIds } from '../utils/containerMembershipInvariants';

function item(partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'name'>): InventoryItem {
  return {
    buyPrice: 0,
    sellPrice: 0,
    status: ItemStatus.IN_STOCK,
    category: 'Components',
    buyDate: '2026-06-01',
    comment1: '',
    comment2: '',
    ...partial,
  } as InventoryItem;
}

const parent = item({
  id: 'bundle-1',
  name: '8x Samsung Evo bundle',
  isBundle: true,
  category: 'Bundle',
  componentIds: ['c1', 'c2'],
  buyPrice: 100,
});

const c1 = item({
  id: 'c1',
  name: 'Samsung Evo 1',
  status: ItemStatus.IN_COMPOSITION,
  parentContainerId: 'bundle-1',
  buyPrice: 50,
});

const c2SoldDetached = item({
  id: 'c2',
  name: 'Samsung Evo 2',
  status: ItemStatus.SOLD,
  parentContainerId: undefined,
  buyPrice: 50,
  sellPrice: 70,
  sellDate: '2026-07-01',
});

// One part still in group — keep shell
assert.deepEqual(findEmptyContainerShellIds([parent, c1, c2SoldDetached]), []);

// Last part also sold+detached, parent emptied
const emptyParent = { ...parent, componentIds: [] as string[], buyPrice: 0 };
const c1Sold = {
  ...c1,
  status: ItemStatus.SOLD,
  parentContainerId: undefined,
  sellPrice: 70,
  sellDate: '2026-07-02',
};
assert.deepEqual(findEmptyContainerShellIds([emptyParent, c1Sold, c2SoldDetached]), ['bundle-1']);

// Sold-with-parent composition (children still linked) — keep shell for sold view/profit
const soldParent = {
  ...parent,
  status: ItemStatus.SOLD,
  sellDate: '2026-07-03',
  sellPrice: 200,
};
const linkedSold1 = {
  ...c1,
  status: ItemStatus.SOLD,
  parentContainerId: 'bundle-1',
  sellDate: '2026-07-03',
};
const linkedSold2 = {
  ...c2SoldDetached,
  status: ItemStatus.SOLD,
  parentContainerId: 'bundle-1',
  componentIds: undefined,
};
assert.deepEqual(
  findEmptyContainerShellIds([
    soldParent,
    linkedSold1,
    { ...linkedSold2, id: 'c2', parentContainerId: 'bundle-1' },
  ]),
  [],
);

console.log('OK: empty container shells detected only when no parts remain');
console.log('\nAll empty-container-shell checks passed.');
