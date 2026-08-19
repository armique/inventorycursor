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

const missing = restoreIntegralRamKit([], []);
assert.equal(missing.changed, true);
assert.equal(missing.items.length, 1);
assert.equal(missing.items[0].id, INTEGRAL_RAM_KIT_ID);
assert.equal(missing.items[0].name, INTEGRAL_RAM_KIT_NAME);
assert.equal(missing.items[0].buyPrice, INTEGRAL_RAM_KIT_BUY);
assert.equal(missing.items[0].sellPrice, INTEGRAL_RAM_KIT_SELL);
assert.equal(missing.items[0].status, ItemStatus.SOLD);
assert.equal(missing.items[0].parentContainerId, undefined);

const again = restoreIntegralRamKit(missing.items, []);
assert.equal(again.changed, false);
assert.equal(again.items.length, 1);

const nested: InventoryItem = {
  ...missing.items[0],
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

const trashed = restoreIntegralRamKit([], [missing.items[0]]);
assert.equal(trashed.changed, true);
assert.equal(trashed.items.length, 1);
assert.equal(trashed.trash.length, 0);
assert.equal(trashed.items[0].sellPrice, INTEGRAL_RAM_KIT_SELL);

const hubPriced: InventoryItem = {
  ...missing.items[0],
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
