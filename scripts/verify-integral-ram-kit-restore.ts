/**
 * Restore missing Integral 32GB Kit sold row at original buy/sell prices.
 * Run: npx tsx scripts/verify-integral-ram-kit-restore.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import {
  INTEGRAL_RAM_KIT_BUY,
  INTEGRAL_RAM_KIT_ID,
  INTEGRAL_RAM_KIT_NAME,
  INTEGRAL_RAM_KIT_SELL,
  restoreIntegralRamKit,
} from '../utils/restoreIntegralRamKit';

// An empty inventory means the data has not loaded yet, not that the kit is
// missing. Fabricating the row here would invent a sold item — and a sale — out
// of nothing, so restore declines. That guard is the behaviour under test; these
// assertions previously expected the row to be created from an empty array.
const notLoaded = restoreIntegralRamKit([], []);
assert.equal(notLoaded.changed, false);
assert.equal(notLoaded.items.length, 0);

// With a genuinely loaded inventory that lacks the kit, it is restored.
const decoy: InventoryItem = {
  id: 'other-1',
  name: 'Unrelated part',
  buyPrice: 5,
  buyDate: '2025-01-01',
  category: 'Components',
  status: ItemStatus.IN_STOCK,
  comment1: '',
  comment2: '',
};
const missing = restoreIntegralRamKit([decoy], []);
assert.equal(missing.changed, true);
const kit = missing.items.find((i) => i.id === INTEGRAL_RAM_KIT_ID)!;
assert.ok(kit, 'kit restored into a loaded inventory');
assert.equal(kit.name, INTEGRAL_RAM_KIT_NAME);
assert.equal(kit.buyPrice, INTEGRAL_RAM_KIT_BUY);
assert.equal(kit.sellPrice, INTEGRAL_RAM_KIT_SELL);
assert.equal(kit.status, ItemStatus.SOLD);
assert.equal(kit.parentContainerId, undefined);
assert.equal(missing.items.length, 2, 'unrelated items are left alone');

const again = restoreIntegralRamKit(missing.items, []);
assert.equal(again.changed, false);
assert.equal(again.items.length, 2);

const nested: InventoryItem = {
  ...kit,
  sellPrice: 0,
  parentContainerId: 'pc-1',
};
const parent: InventoryItem = {
  id: 'pc-1',
  name: 'Some PC',
  buyPrice: 100,
  buyDate: '2025-01-01',
  category: 'PC',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  isPC: true,
  componentIds: [INTEGRAL_RAM_KIT_ID],
};
const unnested = restoreIntegralRamKit([nested, parent], []);
assert.equal(unnested.changed, true);
assert.equal(unnested.items.find((i) => i.id === INTEGRAL_RAM_KIT_ID)?.sellPrice, INTEGRAL_RAM_KIT_SELL);
assert.equal(unnested.items.find((i) => i.id === INTEGRAL_RAM_KIT_ID)?.parentContainerId, undefined);
assert.deepEqual(
  unnested.items.find((i) => i.id === 'pc-1')?.componentIds,
  []
);

const trashed = restoreIntegralRamKit([decoy], [kit]);
assert.equal(trashed.changed, true);
assert.equal(trashed.items.length, 2, 'restored alongside the existing inventory');
assert.equal(trashed.trash.length, 0);
assert.equal(
  trashed.items.find((i) => i.id === INTEGRAL_RAM_KIT_ID)?.sellPrice,
  INTEGRAL_RAM_KIT_SELL
);

const hubPriced: InventoryItem = {
  ...kit,
  sellPrice: 45.19,
  feeAmount: 6.19,
  hasFee: true,
  saleProceeds: {
    capturedAt: '2026-08-19T00:00:00.000Z',
    source: 'ebay_seller_hub',
    itemGrossEur: 39,
    buyerShippingEur: 6.19,
    buyerTotalEur: 45.19,
    shippingLabelEur: 6.19,
    netPayoutEur: 39,
    feesEstimated: false,
  },
};
const hubKept = restoreIntegralRamKit([hubPriced], []);
assert.equal(hubKept.changed, false);
assert.equal(hubKept.items[0].sellPrice, 45.19);
assert.equal(hubKept.items[0].saleProceeds?.buyerTotalEur, 45.19);

console.log('verify-integral-ram-kit-restore: ok');
