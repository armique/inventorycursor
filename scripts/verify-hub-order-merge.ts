/**
 * Hub ledger merge: new Seller Hub rows append / overwrite by order ID.
 * Run: npx tsx scripts/verify-hub-order-merge.ts
 */
import assert from 'node:assert/strict';
import { hydrateHubArchiveIndex, mergeHubOrderLists } from '../services/ebayHubArchiveIndex';
import type { EbayOrderRecord } from '../services/ebayOrderIndex';
import { saleProceedsFromOrder, saleProceedsRows } from '../utils/saleProceeds';
import { hubRefundDisplay } from '../utils/ebayOrderFinancial';

function order(partial: Partial<EbayOrderRecord> & { orderId: string }): EbayOrderRecord {
  return {
    creationDate: '2026-08-19',
    buyer: { username: 'u' },
    lineItems: [{ sku: null, title: 'GPU', lineItemCost: 100 }],
    sources: ['hub'],
    importedAt: '2026-08-19T00:00:00.000Z',
    ...partial,
  };
}

const existing = [
  order({
    orderId: '03-11111-11111',
    grossTotal: 100,
    netTotal: 80,
    financialEvents: [
      { id: 's', date: '2026-08-18', kind: 'sale', amount: 100, transactionType: 'Bestellung', source: 'hub', importedAt: '2026-08-18T00:00:00.000Z' },
      { id: 'a', date: '2026-08-18', kind: 'fee', amount: -10, transactionType: 'Anzeigengebühr Basis', source: 'hub', importedAt: '2026-08-18T00:00:00.000Z' },
      { id: 't', date: '2026-08-18', kind: 'fee', amount: -8, transactionType: 'Transaktionsgebühren', source: 'hub', importedAt: '2026-08-18T00:00:00.000Z' },
      { id: 'l', date: '2026-08-18', kind: 'fee', amount: -2, transactionType: 'Versandetikett', source: 'hub', importedAt: '2026-08-18T00:00:00.000Z' },
    ],
  }),
];

const incoming = [
  order({
    orderId: '03-22222-22222',
    creationDate: '2026-08-19',
    grossTotal: 50,
    netTotal: 40,
    shippingCost: 4.9,
    financialEvents: [
      { id: 's2', date: '2026-08-19', kind: 'sale', amount: 50, transactionType: 'Bestellung', source: 'hub', importedAt: '2026-08-19T12:00:00.000Z' },
      { id: 'a2', date: '2026-08-19', kind: 'fee', amount: -5, transactionType: 'Anzeigengebühr Basis', source: 'hub', importedAt: '2026-08-19T12:00:00.000Z' },
      { id: 'l2', date: '2026-08-19', kind: 'fee', amount: -5, transactionType: 'Versandetikett', source: 'hub', importedAt: '2026-08-19T12:00:00.000Z' },
    ],
  }),
  order({
    orderId: '03-11111-11111',
    netTotal: 79.5,
    grossTotal: 100,
  }),
];

const merged = mergeHubOrderLists(existing, incoming);
assert.equal(merged.added, 1);
assert.equal(merged.merged, 1);
assert.equal(merged.orders.length, 2);
const updated = merged.orders.find((o) => o.orderId === '03-11111-11111');
assert.equal(updated?.netTotal, 79.5);
assert.equal(updated?.financialEvents?.length, 4);
assert.equal(merged.changed.length, 2);

const neu = merged.orders.find((o) => o.orderId === '03-22222-22222');
assert.ok(neu);
const split = saleProceedsFromOrder(neu, neu.lineItems[0]);
assert.equal(split.source, 'ebay_seller_hub');
assert.equal(split.buyerTotalEur, 50);
assert.equal(split.adFeeEur, 5);
assert.equal(split.shippingLabelEur, 5);
assert.equal(split.netPayoutEur, 40);
const labels = saleProceedsRows(split).map((r) => r.label);
assert.ok(labels.includes('Vom Käufer bezahlt'));
assert.ok(labels.includes('Anzeigengebühr'));
assert.ok(labels.includes('Versandetikett'));
assert.ok(labels.includes('Bestelleinnahmen'));

const partialRefund: EbayOrderRecord = order({
  orderId: '03-15053-36524',
  grossTotal: 45.19,
  netTotal: 33.81,
  orderPaymentStatus: 'FULLY_REFUNDED',
  financialEvents: [
    { id: 's', date: '2026-08-01', kind: 'sale', amount: 45.19, transactionType: 'Bestellung', source: 'hub', importedAt: '2026-08-19T00:00:00.000Z' },
    { id: 'l', date: '2026-08-01', kind: 'fee', amount: -6.19, transactionType: 'Versandetikett', source: 'hub', importedAt: '2026-08-19T00:00:00.000Z' },
    { id: 'r', date: '2026-08-02', kind: 'refund', amount: -5, transactionType: 'Teilweise erstattet', source: 'hub', importedAt: '2026-08-19T00:00:00.000Z' },
  ],
});
const refundUi = hubRefundDisplay(partialRefund);
assert.equal(refundUi.kind, 'partial');
assert.equal(refundUi.refundEur, 5);
assert.equal(refundUi.label, 'Teilweise erstattet');
const refundRows = saleProceedsRows(saleProceedsFromOrder(partialRefund, partialRefund.lineItems[0])).map((r) => r.label);
assert.ok(refundRows.includes('Erstattet'));

const goodwillHubStamp: EbayOrderRecord = order({
  orderId: '03-15053-36524',
  grossTotal: 45.19,
  netTotal: 33.81,
  orderPaymentStatus: 'FULLY_REFUNDED',
  financialEvents: [
    { id: 's', date: '2026-08-01', kind: 'sale', amount: 45.19, transactionType: 'Bestellung', source: 'hub', importedAt: '2026-08-19T00:00:00.000Z' },
    { id: 'l', date: '2026-08-01', kind: 'fee', amount: -6.19, transactionType: 'Versandetikett', source: 'hub', importedAt: '2026-08-19T00:00:00.000Z' },
    { id: 'r', date: '2026-08-02', kind: 'refund', amount: -5, transactionType: 'Erstattet', source: 'hub', importedAt: '2026-08-19T00:00:00.000Z' },
  ],
});
const goodwillUi = hubRefundDisplay(goodwillHubStamp);
assert.equal(goodwillUi.kind, 'partial');
assert.equal(goodwillUi.refundEur, 5);
assert.equal(goodwillUi.label, 'Teilweise erstattet');

const fullRefundNeg: EbayOrderRecord = order({
  orderId: '03-99999-00001',
  grossTotal: 45.19,
  netTotal: -6.19,
  financialEvents: [
    { id: 's', date: '2026-08-01', kind: 'sale', amount: 45.19, transactionType: 'Bestellung', source: 'hub', importedAt: '2026-08-19T00:00:00.000Z' },
    { id: 'l', date: '2026-08-01', kind: 'fee', amount: -6.19, transactionType: 'Versandetikett', source: 'hub', importedAt: '2026-08-19T00:00:00.000Z' },
    { id: 'r', date: '2026-08-02', kind: 'refund', amount: -45.19, transactionType: 'Erstattet', source: 'hub', importedAt: '2026-08-19T00:00:00.000Z' },
  ],
});
const fullUi = hubRefundDisplay(fullRefundNeg);
assert.equal(fullUi.kind, 'full');
assert.equal(fullUi.label, 'Erstattet');
assert.equal(fullUi.refundEur, 45.19);

const keepTitle = mergeHubOrderLists(
  [order({ orderId: '03-33333-33333', lineItems: [{ sku: null, title: 'Keep me', lineItemCost: 10 }] })],
  [order({ orderId: '03-33333-33333', lineItems: [], netTotal: 8 })]
);
assert.equal(keepTitle.orders[0].lineItems[0]?.title, 'Keep me');

const fillTitle = mergeHubOrderLists(
  [order({ orderId: '03-44444-44444', lineItems: [] })],
  [order({ orderId: '03-44444-44444', lineItems: [{ sku: null, title: 'From Hub', lineItemCost: 12 }] })]
);
assert.equal(fillTitle.orders[0].lineItems[0]?.title, 'From Hub');

const hydrated = await hydrateHubArchiveIndex();
assert.ok(hydrated.source === 'empty' || hydrated.source === 'memory');
assert.equal(typeof hydrated.count, 'number');

console.log('verify-hub-order-merge: ok');
