/**
 * Stale local Sold must lose to Supabase Active restock on reconcile.
 * Run: npx tsx scripts/verify-sold-active-merge.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import { pickNewerSoldActiveSide, mergeIncomingInventoryRow, healStaleRestockedSoldRows } from '../utils/inventoryCloudMerge';

const cloudRestocked: InventoryItem = {
  id: 'bulk-1776454397757-18',
  name: 'PC Netzteil BE QUIET! PURE POWER BQ L8-500W 500W',
  buyPrice: 1.88,
  category: 'Components',
  status: ItemStatus.IN_STOCK,
  comment2: 'Bulk Import. [Returned 9/2/2026]',
  ebayListingId: '267647201502',
  ebaySaleCycles: [
    {
      id: 'cycle-1',
      closedAt: '2026-09-02T21:28:33.625Z',
      reason: 'manual_unsold',
      reasonLabel: 'Marked unsold',
      sellDate: '2026-09-02',
      sellPrice: 32.69,
      buyPriceAtClose: 6.05,
    },
  ],
  priceHistory: [
    {
      id: 'ph-restock',
      date: '2026-09-02T22:00:00.000Z',
      buyBefore: 6.05,
      buyAfter: 1.88,
      reason: 'manual_edit',
    },
  ],
};

const staleLocalSold: InventoryItem = {
  ...cloudRestocked,
  status: ItemStatus.SOLD,
  sellPrice: 32.69,
  sellDate: '2026-09-02',
  profit: 26.64,
  ebayOrderId: undefined,
  priceHistory: [
    {
      id: 'ph-old-sale',
      date: '2026-05-04T12:00:00.000Z',
      buyBefore: 6.05,
      buyAfter: 6.05,
      reason: 'manual_edit',
    },
  ],
};

assert.equal(
  pickNewerSoldActiveSide(staleLocalSold, cloudRestocked, {
    remoteUpdatedAt: '2026-09-02T22:05:00.000Z',
    localUpdatedAt: '2026-05-04T12:00:00.000Z',
  }),
  'remote',
  'cloud Active restock must beat stale IndexedDB Sold'
);

const mergePair = (remoteList: InventoryItem[], localList: InventoryItem[]) => {
  const remote = remoteList[0];
  const local = localList[0];
  const winner = pickNewerSoldActiveSide(local, remote);
  return [winner === 'local' ? local : remote];
};

const merged = mergeIncomingInventoryRow(staleLocalSold, cloudRestocked, mergePair, {
  remoteUpdatedAt: '2026-09-02T22:05:00.000Z',
  localUpdatedAt: '2026-05-04T12:00:00.000Z',
});

assert.equal(merged?.status, ItemStatus.IN_STOCK, 'merged row stays Active');
assert.equal(merged?.sellPrice, undefined, 'live sell cleared');

const freshLocalSale: InventoryItem = {
  ...cloudRestocked,
  status: ItemStatus.SOLD,
  sellPrice: 18.78,
  sellDate: '2026-09-03',
  priceHistory: [
    {
      id: 'ph-new-sale',
      date: '2026-09-03T10:00:00.000Z',
      buyBefore: 1.88,
      buyAfter: 1.88,
      reason: 'manual_edit',
    },
  ],
};

assert.equal(
  pickNewerSoldActiveSide(freshLocalSale, cloudRestocked, { hasUnsavedLocal: true }),
  'local',
  'unsaved local sale newer than cloud still wins until pushed'
);

const impossibleLocalSold: InventoryItem = {
  ...cloudRestocked,
  status: ItemStatus.SOLD,
  sellPrice: 32.69,
  sellDate: '2026-09-02',
  profit: 26.64,
  comment2: 'Bulk Import (43 items). Source total: €260. [Returned 9/2/2026] [Returned 9/2/2026]',
  priceHistory: [
    ...(cloudRestocked.priceHistory || []),
    { id: 'ph-spurious', date: '2026-09-02T21:50:57.828Z', buyBefore: 1.88, buyAfter: 1.88, reason: 'manual' },
  ],
};

assert.equal(
  pickNewerSoldActiveSide(impossibleLocalSold, cloudRestocked),
  'remote',
  'Sold row with [Returned] markers must lose even when local price history is newer'
);

const healed = healStaleRestockedSoldRows([impossibleLocalSold]);
assert.equal(healed.healedIds.length, 1);
assert.equal(healed.items[0]?.status, ItemStatus.IN_STOCK);
assert.equal(healed.items[0]?.sellPrice, undefined);

console.log('verify-sold-active-merge: ok');
