/**
 * Finances API rows → order cache events (ads / eBay fee / label / net).
 * Run: npx tsx scripts/verify-ebay-finances-map.ts
 */
import assert from 'node:assert/strict';
import {
  financeFeeBucketLabel,
  financeOrderId,
  financeTransactionsToOrderRecords,
  moneyOf,
  type EbayFinanceTransaction,
} from '../utils/ebayFinancesMap';
import { saleProceedsFromOrder } from '../utils/saleProceeds';

assert.equal(moneyOf({ value: '13.72' }), 13.72);
assert.equal(moneyOf('6,19'), 6.19);
assert.equal(
  financeOrderId({
    references: [{ referenceType: 'ORDER_ID', referenceId: '19-11447-34715' }],
  }),
  '19-11447-34715'
);
assert.equal(financeFeeBucketLabel('FINAL_VALUE_FEE', 'Verkaufsprovision'), 'Transaktionsgebühren');
assert.equal(financeFeeBucketLabel('AD_FEE', 'Promoted Listing'), 'Anzeigengebühr Basis');
assert.equal(financeFeeBucketLabel('SHIPPING_LABEL'), 'Versandetikett');

const txs: EbayFinanceTransaction[] = [
  {
    orderId: '19-11447-34715',
    transactionType: 'SALE',
    bookingEntry: 'CREDIT',
    transactionDate: '2025-03-15T12:00:00.000Z',
    buyer: { username: 'buyer1' },
    amount: { value: '107.73' },
    totalFeeAmount: { value: '31.20' },
    totalFeeBasisAmount: { value: '138.93' },
    orderLineItems: [
      {
        marketplaceFees: [
          { feeType: 'FINAL_VALUE_FEE', amount: { value: '11.29' }, feeMemo: 'Verkaufsprovision' },
          { feeType: 'AD_FEE', amount: { value: '13.72' }, feeMemo: 'Anzeigengebühr Basis' },
        ],
      },
    ],
  },
  {
    orderId: '19-11447-34715',
    transactionType: 'SHIPPING_LABEL',
    bookingEntry: 'DEBIT',
    transactionDate: '2025-03-15T13:00:00.000Z',
    amount: { value: '6.19' },
  },
  {
    transactionType: 'TRANSFER',
    bookingEntry: 'DEBIT',
    amount: { value: '500.00' },
  },
];

const records = financeTransactionsToOrderRecords(txs, '2026-08-19T00:00:00.000Z');
assert.equal(records.length, 1);
const order = records[0];
assert.equal(order.orderId, '19-11447-34715');
assert.equal(order.buyer.username, 'buyer1');
assert.equal(order.grossTotal, 138.93);
assert.equal(order.feeTotal, 31.2);
assert.equal(order.netTotal, 107.73);

const split = saleProceedsFromOrder(order, {
  sku: null,
  title: 'GPU',
  lineItemCost: 132.74,
});
assert.equal(split.buyerTotalEur, 138.93);
assert.equal(split.transactionFeeEur, 11.29);
assert.equal(split.adFeeEur, 13.72);
assert.equal(split.shippingLabelEur, 6.19);
assert.equal(split.netPayoutEur, 107.73);
assert.equal(split.feesEstimated, false);
assert.equal(split.source, 'ebay_order');

console.log('verify-ebay-finances-map: ok');
