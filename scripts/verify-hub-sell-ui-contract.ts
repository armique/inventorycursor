/**
 * Hub sell + sell cell display contract for order 08-14793-62151.
 * Run: npx tsx scripts/verify-hub-sell-ui-contract.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import type { EbayOrderRecord } from '../services/ebayOrderIndex';
import { hubSaleColumnSplitForItem } from '../utils/hubOrderProceeds';
import { saleColumnSplit } from '../utils/saleProceeds';
import { applyHubPayoutBreakdownToSoldItem } from '../utils/replaceItemSaleProceedsFromHub';

const order: EbayOrderRecord = {
  orderId: '08-14793-62151',
  creationDate: '2026-06-19',
  buyer: { username: 'ropah-3038', fullName: 'Raphael Otto' },
  lineItems: [
    { sku: 'a', title: '120GB SSD SATA', lineItemCost: 24.37 },
    { sku: 'b', title: 'Samsung SSD 850 EVO 120GB', lineItemCost: 5.67 },
  ],
  grossTotal: 39.85,
  netTotal: 17.79,
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
      amount: -1.2,
      transactionType: 'Transaktionsgebühren',
      source: 'hub',
      importedAt: '2026-08-22T00:00:00.000Z',
    },
    {
      id: '3',
      date: '2026-06-19',
      kind: 'fee',
      amount: -0.8,
      transactionType: 'Anzeigengebühr Basis',
      source: 'hub',
      importedAt: '2026-08-22T00:00:00.000Z',
    },
    {
      id: '4',
      date: '2026-06-19',
      kind: 'fee',
      amount: -6.19,
      transactionType: 'Versandetikett',
      source: 'hub',
      importedAt: '2026-08-22T00:00:00.000Z',
    },
    {
      id: '5',
      date: '2026-06-19',
      kind: 'fee',
      amount: -13.87,
      transactionType: 'Transaktionsgebühren',
      source: 'hub',
      importedAt: '2026-08-22T00:00:00.000Z',
    },
  ],
};

const bundle: InventoryItem = {
  id: 'b1',
  name: '2x 120GB Samsung SSD 840/850 EVO',
  buyPrice: 14.79,
  buyDate: '2024-06-01',
  sellDate: '2026-06-19',
  sellPrice: 30.04,
  category: 'Mixed Bundle',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  isBundle: true,
  componentIds: ['p1', 'p2'],
  ebayOrderId: '08-14793-62151',
};

const p1: InventoryItem = {
  id: 'p1',
  name: '120GB SSD SATA',
  buyPrice: 12,
  buyDate: '2024-06-01',
  sellDate: '2026-06-19',
  sellPrice: 24.37,
  category: 'Components',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  parentContainerId: 'b1',
  ebayOrderId: '08-14793-62151',
};

const p2: InventoryItem = {
  id: 'p2',
  name: 'Samsung SSD 850 EVO 120GB',
  buyPrice: 2.79,
  buyDate: '2024-06-01',
  sellDate: '2026-06-19',
  sellPrice: 5.67,
  category: 'Components',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  parentContainerId: 'b1',
  ebayOrderId: '08-14793-62151',
};

const catalog = [bundle, p1, p2];

const hubSplit = hubSaleColumnSplitForItem(order, bundle, catalog);
assert.equal(hubSplit.totalEur, 39.85, 'hub total received');
assert.equal(hubSplit.shippingEur, 6.19, 'hub delivery deduction');
assert.equal(hubSplit.ebayFeeEur + hubSplit.adFeeEur + hubSplit.otherFeeEur, 3.62, 'hub ebay fees');
assert.equal(hubSplit.netEur, 30.04, 'hub net income');

const applied = applyHubPayoutBreakdownToSoldItem(
  bundle,
  order,
  { sku: 'a', title: '120GB SSD SATA · Samsung SSD 850 EVO 120GB', lineItemCost: 30.04 },
  'SmallBusiness',
  catalog
);

const sellSplit = saleColumnSplit(applied, { displaySellEur: applied.saleProceeds?.buyerTotalEur });
assert.ok(sellSplit);
assert.equal(sellSplit!.totalEur, 39.85, 'sell cell total');
assert.equal(sellSplit!.netEur, 30.04, 'sell cell net');
assert.equal(sellSplit!.shippingEur, 6.19, 'sell cell delivery in breakdown');
assert.equal(sellSplit!.ebayFeeEur, 3.62, 'sell cell ebay fee');

let deductions = 0;
if (sellSplit!.shippingEur >= 0.01) deductions += 1;
if (sellSplit!.ebayFeeEur >= 0.01) deductions += 1;
if (sellSplit!.adFeeEur >= 0.01) deductions += 1;
if (sellSplit!.otherFeeEur >= 0.01) deductions += 1;
assert.equal(deductions, 2, 'sell cell shows 2 deductions');

console.log('verify-hub-sell-ui-contract: ok');
