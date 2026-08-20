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
  saleProceedsFeeTotal,
  saleColumnSplit,
  netPayoutAfterRefund,
  applyManualSellerShipping,
  canEditManualSellerShipping,
  isTrustedEbayProceeds,
  shouldShowSellCellMarketplaceFees,
} from '../utils/saleProceeds';
import { computeItemProfitBeforeOverhead, computeSoldTabMargin } from '../services/financialAggregation';
import type { EbayOrderRecord } from '../services/ebayOrderIndex';
import { applyEbayOrderMatchToItem } from '../utils/applyEbayOrderMatch';
import { buildFinanzamtWareRows } from '../services/finanzamtExportService';

const money = ebayScreenshotSaleFields({
  ebayOrderId: '1',
  ebayUsername: 'buyer',
  buyerFullName: null,
  shippingAddress: null,
  soldPriceExShippingEur: 132.74,
  buyerShippingEur: 6.19,
  ebayFeeEur: 11.29,
  adFeeEur: 13.72,
  shippingLabelEur: 6.19,
  amountReceivedNetEur: 107.73,
});
const fromShot = saleProceedsFromScreenshot(money, money.shippingLabelEur);
assert.equal(fromShot.buyerTotalEur, 138.93, 'buyer total includes Versand');
assert.equal(fromShot.netPayoutEur, 107.73, 'net payout');
assert.equal(saleProceedsHasDetail(fromShot), true, 'screenshot has detail');
assert.equal(fromShot.shippingLabelEur, 6.19, 'screenshot stores Versandetikett');
assert.equal(isTrustedEbayProceeds(fromShot), true, 'screenshot is trusted like Hub');
const shotItem: InventoryItem = {
  id: 'shot-1',
  name: 'RAM',
  buyPrice: 40,
  buyDate: '2024-01-01',
  sellPrice: fromShot.buyerTotalEur ?? 138.93,
  category: 'Components',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  hasFee: true,
  feeAmount: 31.2,
  saleProceeds: fromShot,
};
const shotSplit = saleColumnSplit(shotItem);
assert.equal(shotSplit?.totalEur, 138.93, 'screenshot sell cell uses buyer total');
assert.equal(shotSplit?.adFeeEur, 13.72);
assert.equal(shotSplit?.ebayFeeEur, 11.29);
assert.equal(shotSplit?.shippingEur, 6.19);
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
assert.equal(fromOrder.feesEstimated, false);

const apiOnly: EbayOrderRecord = {
  orderId: 'api-only',
  creationDate: '2026-08-18',
  buyer: { username: 'u2' },
  lineItems: [{ sku: null, title: 'TOSHIBA 1TB HDD', lineItemCost: 40 }],
  grossTotal: 40,
  sources: ['api'],
  importedAt: '2026-08-18T12:00:00.000Z',
};
const fromApi = saleProceedsFromOrder(apiOnly, apiOnly.lineItems[0]);
assert.equal(fromApi.buyerTotalEur, 40, 'API gross still stored as buyer total');
assert.equal(fromApi.transactionFeeEur, null, 'Flip Coach % must not become a tax fee');
assert.equal(fromApi.netPayoutEur, null, 'net unknown without Hub/CSV events');
assert.equal(fromApi.feesEstimated, true, 'API-only payout is estimated');

assert.equal(saleProceedsFeeTotal(fromOrder), 31.2, 'fee buckets sum');
const boundRam: InventoryItem = applyEbayOrderMatchToItem(
  {
    id: 'ram-1',
    name: 'RAM',
    buyPrice: 40,
    buyDate: '2024-01-01',
    category: 'Components',
    status: ItemStatus.IN_STOCK,
    comment1: '',
    comment2: '',
  },
  {
    order,
    lineItem: order.lineItems[0],
    matchScore: 200,
    matchKind: 'title',
  },
  'SmallBusiness'
);
const [ware] = buildFinanzamtWareRows([boundRam]);
assert.equal(ware.Käufer_bezahlt_EUR, 138.93);
assert.equal(ware.Marktplatzgebühren_EUR, 31.2);
assert.equal(ware.Bestelleinnahmen_EUR, 107.73);
assert.equal(ware.Zahlen_Quelle, 'eBay-Abrechnung');
assert.equal(ware.Gewinn_EUR, 67.73);

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

const hubItem: InventoryItem = {
  ...inferred,
  sellPrice: 25.52,
  feeAmount: 7.7,
  sellerPaidShipping: false,
  sellerShippingAmount: undefined,
  saleProceeds: {
    capturedAt: '2026-08-19T00:00:00.000Z',
    source: 'ebay_seller_hub',
    buyerTotalEur: 25.52,
    transactionFeeEur: 2.06,
    adFeeEur: 2.74,
    shippingLabelEur: 2.9,
    netPayoutEur: 17.82,
  },
};
const split = saleColumnSplit(hubItem);
assert.equal(split?.totalEur, 25.52);
assert.equal(split?.ebayFeeEur, 2.06);
assert.equal(split?.adFeeEur, 2.74);
assert.equal(split?.shippingEur, 2.9);
assert.equal(split?.netEur, 17.82);

const corsairSold: InventoryItem = {
  ...inferred,
  name: 'Corsair iCUE LINK System Hub Controller',
  buyPrice: 5,
  sellPrice: 11.77,
  feeAmount: 3.75,
  sellerPaidShipping: false,
  sellerShippingAmount: undefined,
  saleProceeds: {
    capturedAt: '2026-08-19T00:00:00.000Z',
    source: 'ebay_seller_hub',
    buyerTotalEur: 11.77,
    transactionFeeEur: 3.75,
    netPayoutEur: 8.02,
    feesEstimated: false,
  },
};
assert.equal(netPayoutAfterRefund(11.77, 3.75, 8.02, 5), 3.02);
assert.equal(netPayoutAfterRefund(11.77, 3.75, 3.02, 5), 3.02);
const corsairSplit = saleColumnSplit(corsairSold);
assert.equal(corsairSplit?.netEur, 8.02);
assert.equal(saleColumnSplit(corsairSold, { refundFallbackEur: 5 })?.refundEur, 5);
assert.equal(saleColumnSplit(corsairSold, { refundFallbackEur: 5 })?.netEur, 3.02);
const corsairWithRefund: InventoryItem = {
  ...corsairSold,
  saleProceeds: { ...corsairSold.saleProceeds!, refundEur: 5 },
};
assert.equal(saleColumnSplit(corsairWithRefund)?.netEur, 3.02);
const corsairNoProceeds: InventoryItem = { ...corsairSold, saleProceeds: undefined };
assert.equal(computeItemProfitBeforeOverhead(corsairNoProceeds, 'DifferentialVAT'), 1.94);
assert.equal(computeItemProfitBeforeOverhead(corsairWithRefund, 'DifferentialVAT'), -1.98);
assert.equal(computeItemProfitBeforeOverhead(corsairWithRefund, 'SmallBusiness'), -1.98);
const alreadyAfterRefund: InventoryItem = {
  ...corsairSold,
  saleProceeds: { ...corsairSold.saleProceeds!, refundEur: 5, netPayoutEur: 3.02 },
};
assert.equal(saleColumnSplit(alreadyAfterRefund)?.netEur, 3.02);
assert.equal(computeItemProfitBeforeOverhead(alreadyAfterRefund, 'DifferentialVAT'), -1.98);
assert.equal(computeItemProfitBeforeOverhead(alreadyAfterRefund, 'SmallBusiness'), -1.98);

const bluray: InventoryItem = {
  ...inferred,
  name: 'LG BH10LS38 Blu-ray Drive',
  buyPrice: 26.2,
  sellPrice: 52.5,
  feeAmount: 7.33,
  hasFee: true,
  sellerPaidShipping: true,
  sellerShippingAmount: 3.73,
  saleProceeds: {
    capturedAt: '2026-08-19T00:00:00.000Z',
    source: 'ebay_seller_hub',
    buyerTotalEur: 59.83,
    transactionFeeEur: 3.6,
    shippingLabelEur: 3.73,
    netPayoutEur: 52.5,
    feesEstimated: false,
  },
};
assert.equal(computeItemProfitBeforeOverhead(bluray, 'SmallBusiness'), 26.3);
assert.equal(computeSoldTabMargin(bluray), 26.3, 'sold tab stays pocket even if tax mode is Diff/VAT');
assert.equal(computeItemProfitBeforeOverhead(bluray, 'DifferentialVAT'), 22.1);
assert.equal(computeItemProfitBeforeOverhead(bluray, 'RegularVAT'), 17.92);
assert.equal(canEditManualSellerShipping(bluray), false, 'Hub eBay sales do not take typed shipping');

const rx6500xt: InventoryItem = {
  ...inferred,
  id: 'rx-6500-xt',
  name: 'AMD RADEON RX 6500 XT',
  platformSold: 'ebay.de',
  paymentType: 'ebay.de',
  sellPrice: 89,
  feeAmount: 14.2,
  sellerPaidShipping: false,
  sellerShippingAmount: undefined,
  saleProceeds: {
    capturedAt: '2026-08-20T00:00:00.000Z',
    source: 'inferred',
    buyerTotalEur: 89,
    transactionFeeEur: 7.1,
    adFeeEur: 4.2,
    shippingLabelEur: 2.9,
    netPayoutEur: 74.8,
  },
};
assert.equal(isTrustedEbayProceeds(rx6500xt.saleProceeds), false, 'legacy screenshot kept inferred source');
assert.equal(shouldShowSellCellMarketplaceFees(rx6500xt, false), true, 'RX 6500 XT sell cell shows Hub-style split');
assert.equal(saleColumnSplit(rx6500xt)?.adFeeEur, 4.2);
assert.equal(saleColumnSplit(rx6500xt)?.ebayFeeEur, 7.1);
assert.equal(saleColumnSplit(rx6500xt)?.shippingEur, 2.9);

const kleinanzeigenSold: InventoryItem = {
  id: 'ka-1',
  name: 'KA GPU',
  buyPrice: 20,
  buyDate: '2024-01-01',
  sellPrice: 50,
  sellDate: '2024-06-01',
  category: 'Components',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  platformSold: 'kleinanzeigen.de',
};
assert.equal(canEditManualSellerShipping(kleinanzeigenSold), true);
assert.equal(shouldShowSellCellMarketplaceFees(kleinanzeigenSold, false), false, 'KA stays compact without toggle');
assert.equal(computeSoldTabMargin(kleinanzeigenSold), 30);
const kaShipped = applyManualSellerShipping(kleinanzeigenSold, 5.9);
assert.equal(kaShipped.sellerPaidShipping, true);
assert.equal(kaShipped.sellerShippingAmount, 5.9);
assert.equal(computeSoldTabMargin(kaShipped), 24.1);
assert.equal(saleColumnSplit(kaShipped)?.shippingEur, 5.9);
const kaCleared = applyManualSellerShipping(kaShipped, 0);
assert.equal(kaCleared.sellerPaidShipping, false);
assert.equal(computeSoldTabMargin(kaCleared), 30);

console.log('verify-sale-proceeds: ok');
