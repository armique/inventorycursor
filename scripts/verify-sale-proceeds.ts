/**
 * Run: npx tsx scripts/verify-sale-proceeds.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import { ebayScreenshotSaleFields } from '../utils/ebayScreenshotSaleFields';
import {
  saleProceedsFromScreenshot,
  saleProceedsFromOrder,
  resolveSaleProceeds,
  saleProceedsHasDetail,
  saleProceedsRows,
} from '../utils/saleProceeds';
import type { EbayOrderRecord } from '../services/ebayOrderIndex';

const money = ebayScreenshotSaleFields({
  ebayOrderId: '1',
  ebayUsername: 'buyer',
  buyerFullName: null,
  shippingAddress: null,
  soldPriceExShippingEur: 132.74,
  buyerShippingEur: 6.19,
  ebayFeeEur: 11.29,
  adFeeEur: 13.72,
  amountReceivedNetEur: 107.73,
});
const fromShot = saleProceedsFromScreenshot(money, 6.19);
assert.equal(fromShot.buyerTotalEur, 138.93, 'buyer total includes Versand');
assert.equal(fromShot.netPayoutEur, 107.73, 'net payout');
assert.equal(saleProceedsHasDetail(fromShot), true, 'screenshot has detail');
const labels = saleProceedsRows(fromShot).map((r) => r.label);
assert.ok(labels.includes('Transaktionsgebühren'), 'tx fee row');
assert.ok(labels.includes('Anzeigengebühr'), 'ads row');
assert.ok(labels.includes('Versandetikett'), 'label row');
assert.ok(labels.includes('Bestelleinnahmen'), 'net row');

const order: EbayOrderRecord = {
  orderId: '22-1',
  creationDate: '2024-05-08',
  buyer: { username: 'u' },
  lineItems: [{ sku: null, title: 'RAM', lineItemCost: 132.74 }],
  grossTotal: 138.93,
  financialEvents: [
    { id: 's', date: '2024-05-08', kind: 'sale', amount: 138.93, transactionType: 'Bestellung', source: 'csv', importedAt: '' },
    { id: 't', date: '2024-05-08', kind: 'fee', amount: -11.29, transactionType: 'Transaktionsgebühren', source: 'csv', importedAt: '' },
    { id: 'a', date: '2024-05-08', kind: 'fee', amount: -13.72, transactionType: 'Anzeigengebühr Basis', source: 'csv', importedAt: '' },
    { id: 'l', date: '2024-05-08', kind: 'fee', amount: -6.19, transactionType: 'Versandetikett', source: 'csv', importedAt: '' },
  ],
  sources: ['csv'],
  importedAt: '',
};
const fromOrder = saleProceedsFromOrder(order, order.lineItems[0]);
assert.equal(fromOrder.transactionFeeEur, 11.29, 'order tx');
assert.equal(fromOrder.adFeeEur, 13.72, 'order ads');
assert.equal(fromOrder.shippingLabelEur, 6.19, 'order label');
assert.equal(fromOrder.netPayoutEur, 107.73, 'order net');

const inferred: InventoryItem = {
  id: 'x',
  name: 'RAM',
  buyPrice: 40,
  buyDate: '2024-01-01',
  sellPrice: 132.74,
  category: 'Components',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  hasFee: true,
  feeAmount: 25.01,
  sellerPaidShipping: true,
  sellerShippingAmount: 6.19,
};
assert.equal(saleProceedsHasDetail(resolveSaleProceeds(inferred)), true, 'inferred from fees');

console.log('verify-sale-proceeds: ok');
