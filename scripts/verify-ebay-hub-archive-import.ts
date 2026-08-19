/**
 * Hub archive JSON round-trip into the order import parser.
 * Run: npx tsx scripts/verify-ebay-hub-archive-import.ts
 */
import assert from 'node:assert/strict';
import { parseEbayOrderImportText } from '../services/ebayOrderCsvImport';
import { HUB_ARCHIVE_KIND } from '../utils/ebayHubArchiveFile';

const sample = JSON.stringify({
  kind: HUB_ARCHIVE_KIND,
  version: 1,
  fromDate: '2025-01-01',
  orders: [
    {
      orderId: '19-11447-34715',
      creationDate: '2025-03-15',
      buyer: { username: 'buyer1', fullName: 'Alex Buyer', address: 'Hauptstr. 1\n10115 Berlin' },
      lineItems: [{ sku: null, title: 'ASUS Dual RTX 3070', lineItemCost: 132.74 }],
      grossTotal: 138.93,
      netTotal: 107.73,
      feeTotal: 31.2,
      shippingCost: 6.19,
      cancelState: 'CANCELED',
      orderPaymentStatus: 'FULLY_REFUNDED',
      financialEvents: [
        { id: 'a', date: '2025-03-15', kind: 'sale', amount: 138.93, transactionType: 'Bestellung', source: 'hub', importedAt: '2026-08-19T00:00:00.000Z' },
        { id: 'b', date: '2025-03-15', kind: 'fee', amount: -11.29, transactionType: 'Transaktionsgebühren', source: 'hub', importedAt: '2026-08-19T00:00:00.000Z' },
        { id: 'c', date: '2025-03-15', kind: 'fee', amount: -13.72, transactionType: 'Anzeigengebühr Basis', source: 'hub', importedAt: '2026-08-19T00:00:00.000Z' },
        { id: 'd', date: '2025-03-15', kind: 'fee', amount: -6.19, transactionType: 'Versandetikett', source: 'hub', importedAt: '2026-08-19T00:00:00.000Z' },
      ],
      sources: ['hub'],
      importedAt: '2026-08-19T00:00:00.000Z',
    },
  ],
});

const result = parseEbayOrderImportText(sample);
assert.equal(result.orders.length, 1);
assert.equal(result.orders[0].orderId, '19-11447-34715');
assert.equal(result.orders[0].buyer.fullName, 'Alex Buyer');
assert.match(result.orders[0].buyer.address || '', /Berlin/);
assert.equal(result.orders[0].netTotal, 107.73);
assert.equal(result.orders[0].financialEvents?.length, 4);
assert.equal(result.orders[0].cancelState, 'CANCELED');
assert.equal(result.orders[0].orderPaymentStatus, 'FULLY_REFUNDED');
assert.ok(result.orders[0].sources.includes('hub'));

const csv = parseEbayOrderImportText(
  'Order number,Item title,Total price\n99-00000-00001,Test GPU,10.00\n'
);
assert.equal(csv.orders.length, 1);
assert.equal(csv.orders[0].orderId, '99-00000-00001');

console.log('verify-ebay-hub-archive-import: ok');
