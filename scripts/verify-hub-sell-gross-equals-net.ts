/**
 * Hub sell must still show deductions when archive stamped grossTotal = netTotal (Bestelleinnahmen).
 * Run: npx tsx scripts/verify-hub-sell-gross-equals-net.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import type { EbayOrderRecord } from '../services/ebayOrderIndex';
import { hubSaleColumnSplitForItem } from '../utils/hubOrderProceeds';

const brokenOrder: EbayOrderRecord = {
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
  grossTotal: 30.04,
  netTotal: 30.04,
  feeTotal: 9.81,
  sources: ['hub'],
  importedAt: '2026-08-22T00:00:00.000Z',
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
};

const grossEqualsNetOrder: EbayOrderRecord = {
  ...brokenOrder,
  grossTotal: 39.85,
  netTotal: 39.85,
};

const bundle: InventoryItem = {
  id: 'bundle-ssd',
  name: '2x 120GB Samsung SSD 840/850 EVO',
  buyPrice: 14.79,
  buyDate: '2024-06-01',
  sellDate: '2024-04-19',
  sellPrice: 30.04,
  category: 'Mixed Bundle',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  isBundle: true,
  componentIds: ['p1', 'p2'],
  ebayOrderId: '08-14793-62151',
  platformSold: 'ebay.de',
};

const items = [bundle];

for (const [label, order] of [
  ['gross=net=30.04', brokenOrder],
  ['gross=net=39.85', grossEqualsNetOrder],
] as const) {
  const split = hubSaleColumnSplitForItem(order, bundle, items);
  assert.equal(split.totalEur, 39.85, `${label}: Gesamtbetrag`);
  assert.equal(split.shippingEur, 6.19, `${label}: delivery`);
  assert.equal(split.ebayFeeEur + split.adFeeEur + split.otherFeeEur, 3.62, `${label}: eBay fees`);
  assert.equal(split.netEur, 30.04, `${label}: Bestelleinnahmen`);
  assert.notEqual(split.totalEur, split.netEur, `${label}: total must differ from net`);
}

console.log('verify-hub-sell-gross-equals-net: ok');
