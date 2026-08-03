/**
 * Sold PC/bundle platform tags must cascade onto linked parts.
 * Run: npx tsx scripts/verify-container-sale-cascade.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import {
  applyContainerSaleMetaToChild,
  expandUpdatesWithContainerSaleMeta,
  extractContainerSaleMeta,
  syncContainerSaleMetaToChildren,
} from '../utils/containerSaleCascade';

function item(partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'name'>): InventoryItem {
  return {
    buyPrice: 0,
    sellPrice: 0,
    status: ItemStatus.IN_STOCK,
    category: 'Components',
    subCategory: 'Storage',
    buyDate: '2026-01-01',
    comment1: '',
    comment2: '',
    ...partial,
  } as InventoryItem;
}

const childA = item({
  id: 'cpu-1',
  name: 'i7-4790K',
  status: ItemStatus.IN_COMPOSITION,
  parentContainerId: 'pc-1',
  buyPrice: 40,
});
const childB = item({
  id: 'mobo-1',
  name: 'Z97 Board',
  status: ItemStatus.IN_COMPOSITION,
  parentContainerId: 'pc-1',
  buyPrice: 30,
});
const soldPc = item({
  id: 'pc-1',
  name: 'Office PC',
  category: 'PC',
  isPC: true,
  isBundle: true,
  status: ItemStatus.SOLD,
  sellPrice: 120,
  sellDate: '2026-07-20',
  platformSold: 'ebay.de',
  paymentType: 'ebay.de',
  ebayOrderId: 'ORD-99',
  ebayUsername: 'buyer99',
  componentIds: ['cpu-1', 'mobo-1'],
});

const meta = extractContainerSaleMeta(soldPc);
assert.equal(meta.platformSold, 'ebay.de');
assert.equal(meta.ebayOrderId, 'ORD-99');

const stamped = applyContainerSaleMetaToChild(childA, meta);
assert.equal(stamped.platformSold, 'ebay.de');
assert.equal(stamped.paymentType, 'ebay.de');
assert.equal(stamped.ebayOrderId, 'ORD-99');
assert.equal(stamped.status, ItemStatus.IN_COMPOSITION, 'status/prices stay untouched');

const synced = syncContainerSaleMetaToChildren([soldPc, childA, childB], [soldPc.id]);
const syncedA = synced.find((i) => i.id === 'cpu-1')!;
const syncedB = synced.find((i) => i.id === 'mobo-1')!;
assert.equal(syncedA.platformSold, 'ebay.de');
assert.equal(syncedB.platformSold, 'ebay.de');
assert.equal(syncedA.ebayUsername, 'buyer99');

const untouched = syncContainerSaleMetaToChildren([soldPc, childA, childB], ['cpu-1']);
assert.equal(
  untouched.find((i) => i.id === 'cpu-1')!.platformSold,
  undefined,
  'only touched containers cascade'
);

const kaPc = { ...soldPc, platformSold: 'kleinanzeigen.de' as const, paymentType: 'Kleinanzeigen (Cash)' as const };
const expanded = expandUpdatesWithContainerSaleMeta([kaPc], [kaPc, childA, childB]);
assert.equal(expanded.length, 3);
assert.ok(expanded.every((i) => i.id === 'pc-1' || i.platformSold === 'kleinanzeigen.de'));

console.log('verify-container-sale-cascade: ok');
