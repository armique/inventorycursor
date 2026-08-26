/**
 * Inventory eBay sales appear on Abrechnung before CSV import; CSV wins on duplicate orders.
 * Run: npx tsx scripts/verify-ebay-tx-inventory-ledger.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import {
  buildEbayTxRowsFromInventory,
  mergeEbayTxRowsWithInventory,
} from '../utils/ebayTxInventoryLedger';
import type { EbayTxRow } from '../utils/ebayTransactionReport';

const sold: InventoryItem = {
  id: 'psu-1',
  name: 'Cooler Master V750 SFX',
  buyPrice: 40,
  buyDate: '2026-01-01',
  sellDate: '2026-04-10',
  sellPrice: 95,
  status: ItemStatus.SOLD,
  category: 'Components',
  platformSold: 'ebay.de',
  paymentType: 'ebay.de',
  ebayOrderId: '11-00000-11111',
  ebayUsername: 'buyer_a',
  saleProceeds: {
    capturedAt: '2026-04-10T12:00:00.000Z',
    source: 'ebay_order',
    itemGrossEur: 88,
    buyerShippingEur: 7,
    buyerTotalEur: 95,
    transactionFeeEur: 12,
    shippingLabelEur: 6.19,
    netPayoutEur: 76.81,
    feesEstimated: false,
  },
};

const restocked: InventoryItem = {
  id: 'ram-1',
  name: 'Corsair 32GB DDR4',
  buyPrice: 52,
  buyDate: '2026-01-01',
  status: ItemStatus.IN_STOCK,
  category: 'Components',
  ebaySaleCycles: [
    {
      id: 'cycle-1',
      closedAt: '2026-04-15T10:00:00.000Z',
      reason: 'erstattet',
      reasonLabel: 'Erstattet',
      sellDate: '2026-04-01',
      sellPrice: 62,
      platformSold: 'ebay.de',
      paymentType: 'ebay.de',
      ebayOrderId: '11-00000-22222',
      buyPriceAtClose: 40,
      leftoverLossEur: 12.29,
      refundKind: 'full',
      saleProceeds: {
        capturedAt: '2026-04-01T12:00:00.000Z',
        source: 'ebay_order',
        buyerTotalEur: 62,
        transactionFeeEur: 8,
        shippingLabelEur: 6.19,
        netPayoutEur: 47.81,
        feesEstimated: false,
      },
    },
  ],
};

const invRows = buildEbayTxRowsFromInventory([sold, restocked]);
assert.ok(invRows.some((row) => row.kind === 'order' && row.orderId === '11-00000-11111'));
assert.ok(invRows.some((row) => row.kind === 'refund' && row.orderId === '11-00000-22222'));
assert.equal(invRows.every((row) => row.source === 'inventory'), true);

const csvOrder: EbayTxRow = {
  id: 'csv-order-1',
  kind: 'order',
  typeRaw: 'Bestellung',
  orderId: '11-00000-11111',
  title: 'Cooler Master V750 SFX',
  createdSort: '2026-04-10',
  createdAt: '10.04.2026',
  grossEur: 95,
  itemSubtotalEur: 88,
  shippingEur: 7,
  netEur: 80,
};

const merged = mergeEbayTxRowsWithInventory([csvOrder], [sold, restocked]);
assert.equal(merged.filter((row) => row.kind === 'order' && row.orderId === '11-00000-11111').length, 1);
assert.equal(
  merged.find((row) => row.kind === 'order' && row.orderId === '11-00000-11111')?.id,
  'csv-order-1',
  'CSV order row wins over inventory duplicate'
);
assert.ok(merged.some((row) => row.orderId === '11-00000-22222'), 'restocked cycle still visible');

console.log('verify-ebay-tx-inventory-ledger: ok');
