/**
 * Real scraped Hub archive shape for 08-14793-62151 (bogus line title, correct financialEvents).
 * Run: npx tsx scripts/verify-hub-sell-scraped-archive.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import type { EbayOrderRecord } from '../services/ebayOrderIndex';
import { hubSaleColumnSplitForItem } from '../utils/hubOrderProceeds';

const scrapedOrder: EbayOrderRecord = {
  orderId: '08-14793-62151',
  creationDate: '2026-06-19',
  buyer: { fullName: 'Raphael Otto' },
  lineItems: [
    {
      sku: null,
      title: 'rm4ik hat einen Bewertungspunktestand von 840',
      lineItemCost: 33.66,
    },
  ],
  grossTotal: 39.85,
  netTotal: 30.04,
  feeTotal: 9.81,
  shippingCost: 6.19,
  financialEvents: [
    {
      id: '1',
      date: '2026-06-19',
      kind: 'sale',
      amount: 39.85,
      transactionType: 'Bestellung',
      source: 'hub',
      importedAt: '2026-08-22T00:00:00.000Z',
    },
    {
      id: '2',
      date: '2026-06-19',
      kind: 'fee',
      amount: -3.62,
      transactionType: 'Transaktionsgebühren',
      source: 'hub',
      importedAt: '2026-08-22T00:00:00.000Z',
    },
    {
      id: '3',
      date: '2026-06-19',
      kind: 'fee',
      amount: -6.19,
      transactionType: 'Versandetikett',
      source: 'hub',
      importedAt: '2026-08-22T00:00:00.000Z',
    },
  ],
  sources: ['hub'],
  importedAt: '2026-08-22T00:00:00.000Z',
};

const bundle: InventoryItem = {
  id: 'bundle-ssd',
  name: '2x 120GB Samsung SSD 840/850 EVO',
  buyPrice: 14.79,
  buyDate: '2024-06-01',
  sellDate: '2024-04-19',
  sellPrice: 33.66,
  category: 'Mixed Bundle',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  isBundle: true,
  componentIds: ['p1', 'p2'],
  ebayOrderId: '08-14793-62151',
  platformSold: 'ebay.de',
};

const p1: InventoryItem = {
  id: 'p1',
  name: '120GB SSD SATA',
  buyPrice: 12,
  sellDate: '2024-04-19',
  sellPrice: 24.37,
  category: 'Components',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  parentContainerId: 'bundle-ssd',
  ebayOrderId: '08-14793-62151',
};

const p2: InventoryItem = {
  id: 'p2',
  name: 'Samsung SSD 850 EVO 120GB',
  buyPrice: 2.79,
  sellDate: '2024-04-19',
  sellPrice: 5.67,
  category: 'Components',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  parentContainerId: 'bundle-ssd',
  ebayOrderId: '08-14793-62151',
};

const split = hubSaleColumnSplitForItem(scrapedOrder, bundle, [bundle, p1, p2]);
assert.equal(split.totalEur, 39.85, 'must not prorate total to 19.93');
assert.equal(split.shippingEur, 6.19, 'delivery');
assert.equal(split.ebayFeeEur + split.adFeeEur + split.otherFeeEur, 3.62, 'ebay fees');
assert.equal(split.netEur, 30.04, 'Bestelleinnahmen');

console.log('verify-hub-sell-scraped-archive: ok', split);
