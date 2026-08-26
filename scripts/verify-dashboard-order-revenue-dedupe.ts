import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import {
  dedupeOrderGroupProfit,
  dedupeOrderGroupRevenue,
  sumDedupedSaleProfit,
  sumDedupedSaleRevenue,
} from '../utils/salePlatform';

const sharedOrder = '12-34567-89012';

const dupA: InventoryItem = {
  id: 'a',
  name: 'Corsair RAM',
  buyPrice: 20,
  buyDate: '2026-08-01',
  sellDate: '2026-08-10',
  sellPrice: 120,
  category: 'RAM',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  ebayOrderId: sharedOrder,
  saleProceeds: {
    capturedAt: '',
    source: 'ebay_order',
    buyerTotalEur: 120,
    netPayoutEur: 100,
    feesEstimated: false,
  },
};

const dupB: InventoryItem = {
  ...dupA,
  id: 'b',
  name: 'NZXT Fan',
  buyPrice: 10,
  sellPrice: 120,
  saleProceeds: {
    capturedAt: '',
    source: 'ebay_order',
    buyerTotalEur: 120,
    netPayoutEur: 100,
    feesEstimated: false,
  },
};

assert.equal(dedupeOrderGroupRevenue([dupA, dupB]), 120);
assert.equal(sumDedupedSaleRevenue([dupA, dupB]), 120);

// Inflated naive sum: (100-20) + (100-10) = 170; correct is 100 - 30 = 70
assert.equal(dedupeOrderGroupProfit([dupA, dupB], 'SmallBusiness'), 70);
assert.equal(sumDedupedSaleProfit([dupA, dupB], 'SmallBusiness'), 70);

const splitA: InventoryItem = { ...dupA, sellPrice: 60, saleProceeds: undefined };
const splitB: InventoryItem = { ...dupB, sellPrice: 60, saleProceeds: undefined };
assert.equal(sumDedupedSaleRevenue([splitA, splitB]), 120);
// Distinct line prices → sum of individual profits: (60-20) + (60-10) = 90
assert.equal(sumDedupedSaleProfit([splitA, splitB], 'SmallBusiness'), 90);

console.log('verify-dashboard-order-revenue-dedupe: ok');
