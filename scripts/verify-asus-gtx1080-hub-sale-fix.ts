/**
 * ASUS GTX 1080 ROG Strix Hub sell stamp for order 26-14839-00163.
 * Run: npx tsx scripts/verify-asus-gtx1080-hub-sale-fix.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import type { EbayOrderFinancialEvent, EbayOrderRecord } from '../services/ebayOrderIndex';
import {
  ASUS_GTX1080_ROG_ADS,
  ASUS_GTX1080_ROG_BUYER_SHIP,
  ASUS_GTX1080_ROG_BUYER_TOTAL,
  ASUS_GTX1080_ROG_ITEM,
  ASUS_GTX1080_ROG_LABEL,
  ASUS_GTX1080_ROG_NET,
  ASUS_GTX1080_ROG_ORDER_ID,
  ASUS_GTX1080_ROG_TX,
  applyAsusGtx1080RogStrixHubSaleFix,
  isAsusGtx1080RogStrixName,
} from '../utils/asusGtx1080RogStrixHubSaleFix';
import { getHubBestelleinnahmen } from '../utils/ebayOrderFinancial';
import {
  applyHubPayoutBreakdownToSoldItem,
  buildHubBreakdownReplacePlan,
} from '../utils/replaceItemSaleProceedsFromHub';
import { hubReconciledFeeSplit, saleColumnSplit } from '../utils/saleProceeds';

function hubEvent(
  orderId: string,
  amount: number,
  kind: EbayOrderFinancialEvent['kind'],
  transactionType: string
): EbayOrderFinancialEvent {
  return {
    id: `${orderId}:${transactionType}:${amount}`,
    date: '2026-07-07',
    kind,
    amount,
    transactionType,
    source: 'hub',
    importedAt: '2026-08-19T00:00:00.000Z',
  };
}

const wrong: InventoryItem = {
  id: 'gtx-1080-rog',
  name: 'ASUS GeForce GTX 1080 ROG Strix',
  buyPrice: 70,
  buyDate: '2026-06-01',
  sellDate: '2026-07-07',
  sellPrice: 118.04,
  category: 'Components',
  subCategory: 'GPU',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  ebayOrderId: ASUS_GTX1080_ROG_ORDER_ID,
  platformSold: 'ebay.de',
  paymentType: 'ebay.de',
  hasFee: true,
  feeAmount: 8.04,
  saleProceeds: {
    capturedAt: '2026-07-07T00:00:00.000Z',
    source: 'ebay_seller_hub',
    buyerTotalEur: 126.08,
    transactionFeeEur: 8.04,
    adFeeEur: null,
    shippingLabelEur: null,
    netPayoutEur: 118.04,
    feesEstimated: false,
  },
};

assert.equal(isAsusGtx1080RogStrixName('ASUS GeForce GTX 1080 ROG Strix'), true);
assert.equal(isAsusGtx1080RogStrixName('ASUS ROG STRIX GTX 1080 Ti'), false);

const first = applyAsusGtx1080RogStrixHubSaleFix([wrong], 'SmallBusiness');
assert.equal(first.changed, true);
const fixed = first.items[0];
assert.equal(fixed.sellPrice, ASUS_GTX1080_ROG_BUYER_TOTAL);
assert.equal(fixed.saleProceeds?.itemGrossEur, ASUS_GTX1080_ROG_ITEM);
assert.equal(fixed.saleProceeds?.buyerShippingEur, ASUS_GTX1080_ROG_BUYER_SHIP);
assert.equal(fixed.saleProceeds?.transactionFeeEur, ASUS_GTX1080_ROG_TX);
assert.equal(fixed.saleProceeds?.adFeeEur, ASUS_GTX1080_ROG_ADS);
assert.equal(fixed.saleProceeds?.shippingLabelEur, ASUS_GTX1080_ROG_LABEL);
assert.equal(fixed.saleProceeds?.netPayoutEur, ASUS_GTX1080_ROG_NET);
assert.equal(fixed.profit, 26.84);
const split = saleColumnSplit(fixed);
assert.equal(split?.totalEur, 126.08);
assert.equal(split?.adFeeEur, 15.01);
assert.equal(split?.ebayFeeEur, 8.04);
assert.equal(split?.shippingEur, 6.19);
assert.equal(split?.netEur, 96.84);

const again = applyAsusGtx1080RogStrixHubSaleFix(first.items, 'SmallBusiness');
assert.equal(again.changed, false);

const emptyLineHub: EbayOrderRecord = {
  orderId: ASUS_GTX1080_ROG_ORDER_ID,
  creationDate: '2026-07-07',
  buyer: { fullName: 'Dominik Kardos' },
  lineItems: [],
  grossTotal: 126.08,
  netTotal: 118.04,
  feeTotal: 29.24,
  shippingCost: 6.19,
  sources: ['hub'],
  importedAt: '2026-08-19T00:00:00.000Z',
  financialEvents: [
    hubEvent(ASUS_GTX1080_ROG_ORDER_ID, 126.08, 'sale', 'Bestellung'),
    hubEvent(ASUS_GTX1080_ROG_ORDER_ID, -8.04, 'fee', 'Transaktionsgebühren'),
    hubEvent(ASUS_GTX1080_ROG_ORDER_ID, -15.01, 'fee', 'Anzeigengebühr Basis'),
    hubEvent(ASUS_GTX1080_ROG_ORDER_ID, -6.19, 'fee', 'Versandetikett'),
  ],
};

assert.equal(getHubBestelleinnahmen(emptyLineHub), 96.84);
const hubSplit = hubReconciledFeeSplit(emptyLineHub);
assert.equal(hubSplit.buyerTotalEur, 126.08);
assert.equal(hubSplit.itemGrossEur, 119.89);
assert.equal(hubSplit.buyerShippingEur, 6.19);
assert.equal(hubSplit.transactionFeeEur, 8.04);
assert.equal(hubSplit.adFeeEur, 15.01);
assert.equal(hubSplit.shippingLabelEur, 6.19);
assert.equal(hubSplit.netPayoutEur, 96.84);

const plan = buildHubBreakdownReplacePlan([wrong], [emptyLineHub], 'SmallBusiness');
assert.equal(plan.length, 1);
assert.equal(plan[0].after.sell, 126.08);
assert.equal(plan[0].after.net, 96.84);
assert.equal(plan[0].after.ads, 15.01);
assert.equal(plan[0].after.ebay, 8.04);
assert.equal(plan[0].after.ship, 6.19);

const applied = applyHubPayoutBreakdownToSoldItem(
  wrong,
  emptyLineHub,
  { sku: null, title: wrong.name, lineItemCost: 119.89 },
  'SmallBusiness',
  [wrong]
);
assert.equal(applied.sellPrice, 126.08);
assert.equal(applied.saleProceeds?.adFeeEur, 15.01);
assert.equal(applied.saleProceeds?.netPayoutEur, 96.84);

console.log('verify-asus-gtx1080-hub-sale-fix: ok');
