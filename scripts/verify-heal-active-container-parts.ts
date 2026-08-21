/**
 * Heal Active PC part nesting / ghost standalone duplicates after restock.
 * Run: npx tsx scripts/verify-heal-active-container-parts.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import { healActiveContainerPartMembership } from '../utils/healActiveContainerPartMembership';
import {
  ASUS_A320M_PC_BUY,
  ASUS_A320M_PC_NAME,
  ASUS_A320M_PC_SELL,
  isAsusA320mPcTitle,
  restoreAsusA320mPcSale,
} from '../utils/restoreAsusA320mPcSale';

const gpuNested: InventoryItem = {
  id: 'gpu-nested',
  name: 'MSI GTX 1080 X 8G',
  buyPrice: 90,
  buyDate: '2025-01-01',
  category: 'Components',
  subCategory: 'GPU',
  status: ItemStatus.IN_STOCK,
  comment1: '',
  comment2: '',
};
const gpuGhost: InventoryItem = {
  id: 'gpu-ghost',
  name: 'MSI GTX 1080 x 8G',
  buyPrice: 90,
  buyDate: '2025-01-01',
  category: 'Components',
  subCategory: 'GPU',
  status: ItemStatus.IN_STOCK,
  comment1: '',
  comment2: '[Returned 20.08.2026]',
};
const pc: InventoryItem = {
  id: 'pc-returned',
  name: 'PC · Returned Build',
  buyPrice: 200,
  buyDate: '2025-01-01',
  category: 'PC',
  status: ItemStatus.IN_STOCK,
  isPC: true,
  componentIds: ['gpu-nested'],
  comment1: '',
  comment2: '[Returned 20.08.2026]',
};

const healed = healActiveContainerPartMembership([pc, gpuNested, gpuGhost]);
assert.equal(healed.changed, true);
assert.equal(healed.toTrash.length, 1);
assert.equal(healed.toTrash[0].id, 'gpu-ghost');
const nested = healed.items.find((i) => i.id === 'gpu-nested')!;
assert.equal(nested.status, ItemStatus.IN_COMPOSITION);
assert.equal(nested.parentContainerId, 'pc-returned');
assert.equal(healed.items.some((i) => i.id === 'gpu-ghost'), false);

// ASUS title match without isPC flag
assert.equal(isAsusA320mPcTitle(ASUS_A320M_PC_NAME), true);
const loose: InventoryItem = {
  id: 'pc-asus-loose',
  name: ASUS_A320M_PC_NAME,
  buyPrice: 100,
  buyDate: '2025-09-01',
  category: 'PC',
  status: ItemStatus.IN_STOCK,
  comment1: '',
  comment2: '[Returned 20.08.2026]',
  // intentionally no isPC
};
const restored = restoreAsusA320mPcSale([loose]);
assert.equal(restored.changed, true);
const sold = restored.items.find((i) => i.id === 'pc-asus-loose')!;
assert.equal(sold.status, ItemStatus.SOLD);
assert.equal(sold.buyPrice, ASUS_A320M_PC_BUY);
assert.equal(sold.sellPrice, ASUS_A320M_PC_SELL);
assert.equal(sold.isPC, true);

console.log('verify-heal-active-container-parts: ok');
