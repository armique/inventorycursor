/**
 * Dashboard sale lines must count sold PC/bundle Gesamtbetrag once.
 * Run: npx tsx scripts/verify-dashboard-sale-aggregation.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import {
  resolvedSaleRevenue,
  shouldSkipForAggregatedSaleLine,
  shouldSkipSoldContainerChildForSaleTotals,
} from '../services/financialAggregation';

const parent: InventoryItem = {
  id: 'pc-z390',
  name: 'PC · ASUS Z390-A · i9-9900K',
  buyPrice: 42.74,
  buyDate: '2026-07-01',
  sellDate: '2026-08-08',
  sellPrice: 322.69,
  category: 'PC',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  isPC: true,
  componentIds: ['cpu', 'mb', 'ram'],
  ebayOrderId: '08-15006-70011',
  platformSold: 'ebay.de',
  saleProceeds: {
    capturedAt: '2026-08-08T00:00:00.000Z',
    source: 'ebay_seller_hub',
    buyerTotalEur: 322.69,
    netPayoutEur: 260.7,
    feesEstimated: false,
  },
};

const child = (id: string, name: string, sell: number, buy: number): InventoryItem => ({
  id,
  name,
  buyPrice: buy,
  buyDate: '2026-07-01',
  sellDate: '2026-08-08',
  sellPrice: sell,
  category: 'Components',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  parentContainerId: parent.id,
  ebayOrderId: '08-15006-70011',
  platformSold: 'ebay.de',
});

const kids = [
  child('cpu', 'i9-9900K', 200, 20),
  child('mb', 'Z390-A', 80, 15),
  child('ram', '16GB DDR4', 35.01, 7.74),
];
const catalog = [parent, ...kids];

assert.equal(shouldSkipSoldContainerChildForSaleTotals(kids[0], catalog), true);
assert.equal(shouldSkipForAggregatedSaleLine(kids[0], catalog), true);
assert.equal(shouldSkipForAggregatedSaleLine(parent, catalog), false);

const counted = catalog.filter((i) => i.status === ItemStatus.SOLD && !shouldSkipForAggregatedSaleLine(i, catalog));
assert.deepEqual(counted.map((i) => i.id), ['pc-z390']);
assert.equal(resolvedSaleRevenue(parent), 322.69);

const drifted: InventoryItem = {
  ...parent,
  id: 'gpu-xt',
  isPC: false,
  componentIds: undefined,
  sellPrice: 95.03,
  saleProceeds: {
    capturedAt: '2026-08-19T00:00:00.000Z',
    source: 'ebay_seller_hub',
    buyerTotalEur: 101.22,
    netPayoutEur: 76.43,
    feesEstimated: false,
  },
};
assert.equal(resolvedSaleRevenue(drifted), 101.22);

console.log('verify-dashboard-sale-aggregation: ok');
