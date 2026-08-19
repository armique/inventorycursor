/**
 * Seller Hub payout parser: buyer total, eBay fee, ads, label, net remainder.
 * Run: npx tsx scripts/verify-ebay-seller-hub-payout.ts
 */
import assert from 'node:assert/strict';
import {
  parseEbaySellerHubPayoutText,
  pickSellerHubMatch,
  payoutLooksComplete,
  harvestPayoutFromCapturedPayload,
  payoutFromHubVisionJson,
  applyBusinessTxFeePolicy,
  extractHubOrderLifecycle,
  parseGermanHubDate,
  extractHubListingTitle,
  hubOrderRowsFromUnknown,
} from '../lib/ebaySellerHubPayout.js';
import { saleFieldsFromHubPayout } from '../utils/ebaySellerHubSaleFields';
import { hubOrderRecordFromDetailText, parseHubBrowserDump, hubOrdersFromBrowserDump, HUB_BROWSER_DUMP_KIND } from '../utils/hubBrowserDump';
import { applyEbayOrderMatchToItem } from '../utils/applyEbayOrderMatch';
import { financialEventsFromHubPayout } from '../utils/ebaySellerHubOrderCache';
import { ItemStatus, type InventoryItem } from '../types';
import type { EbayOrderRecord } from '../services/ebayOrderIndex';

const SAMPLE = `
Bestellung 19-11447-34715
Vom Käufer bezahlt
Zwischensumme 132,74 €
Versand 6,19 €
Gesamtbetrag 138,93 €

Ihr Verkaufserlös
Transaktionsgebühren -11,29 €
Versandetikett -6,19 €
Anzeigengebühr Basis -13,72 €
Bestelleinnahmen 107,73 €
`;

const payout = parseEbaySellerHubPayoutText(SAMPLE);
assert.equal(payout.orderId, '19-11447-34715');
assert.equal(payout.itemGrossEur, 132.74);
assert.equal(payout.buyerShippingEur, 6.19);
assert.equal(payout.buyerTotalEur, 138.93);
assert.equal(payout.transactionFeeEur, 11.29);
assert.equal(payout.adFeeEur, 13.72);
assert.equal(payout.shippingLabelEur, 6.19);
assert.equal(payout.netPayoutEur, 107.73);
assert.equal(payoutLooksComplete(payout), true);

const fields = saleFieldsFromHubPayout(payout);
assert.equal(fields.sellPrice, 138.93);
assert.equal(fields.feeAmount, 31.2);
assert.equal(fields.hasFee, true);
assert.equal(fields.sellerPaidShipping, false);
assert.equal(fields.sellerShippingAmount, 0);
assert.equal(fields.saleProceeds.netPayoutEur, 107.73);
assert.equal(fields.saleProceeds.source, 'ebay_seller_hub');
assert.equal(fields.saleProceeds.shippingLabelEur, 6.19);

const fromPage = hubOrderRecordFromDetailText('19-11447-34715', SAMPLE);
assert.equal(fromPage.sources[0], 'hub');
assert.equal(fromPage.grossTotal, 138.93);
assert.equal(fromPage.netTotal, 107.73);
assert.equal((fromPage.financialEvents || []).some((e) => e.transactionType === 'Anzeigengebühr Basis'), true);

const dump = parseHubBrowserDump(JSON.stringify({
  kind: HUB_BROWSER_DUMP_KIND,
  version: 1,
  fetchedAt: '2026-08-19T00:00:00.000Z',
  pages: [{ orderId: '19-11447-34715', text: SAMPLE }],
}));
assert.ok(dump);
assert.equal(hubOrdersFromBrowserDump(dump!).length, 1);
assert.equal(hubOrdersFromBrowserDump(dump!)[0].orderId, '19-11447-34715');

const netCheck = 138.93 - 11.29 - 13.72 - 6.19;
assert.equal(Math.round(netCheck * 100) / 100, 107.73);

const TOSHIBA_HUB = `
Ihr Verkaufserlös

Gesamtbetrag
25,52 €
Verkaufskosten
Transaktionsgebühren
-2,06 €
Versandetikett
-2,90 €
Anzeigengebühr Basis
-2,74 €
Bestelleinnahmen
17,82 €
`;
const toshiba = parseEbaySellerHubPayoutText(TOSHIBA_HUB);
assert.equal(toshiba.buyerTotalEur, 25.52);
assert.equal(toshiba.transactionFeeEur, 2.06);
assert.equal(toshiba.shippingLabelEur, 2.9);
assert.equal(toshiba.adFeeEur, 2.74);
assert.equal(toshiba.netPayoutEur, 17.82);
assert.equal(payoutLooksComplete(toshiba), true);
const toshibaFees =
  (toshiba.transactionFeeEur || 0) + (toshiba.adFeeEur || 0) + (toshiba.shippingLabelEur || 0);
assert.equal(Math.round(toshibaFees * 100) / 100, 7.7);
assert.equal(Math.round((25.52 - toshibaFees) * 100) / 100, 17.82);

const toshibaOrder: EbayOrderRecord = {
  orderId: 'ord-toshiba-hub',
  creationDate: '2026-08-18',
  buyer: { username: 'hdd-buyer' },
  lineItems: [{ sku: null, title: 'TOSHIBA 1TB HDD', lineItemCost: 25.52 }],
  grossTotal: 25.52,
  sources: ['api'],
  importedAt: '2026-08-18T12:00:00.000Z',
  financialEvents: financialEventsFromHubPayout(
    {
      orderId: 'ord-toshiba-hub',
      creationDate: '2026-08-18',
      buyer: { username: 'hdd-buyer' },
      lineItems: [{ sku: null, title: 'TOSHIBA 1TB HDD', lineItemCost: 25.52 }],
      sources: ['api'],
      importedAt: '2026-08-18T12:00:00.000Z',
    },
    toshiba
  ),
};
const toshibaItem: InventoryItem = {
  id: 'hdd-toshiba',
  name: 'Toshiba 1TB HDD',
  buyPrice: 8,
  buyDate: '2026-01-01',
  category: 'Storage',
  status: ItemStatus.IN_STOCK,
  comment1: '',
  comment2: '',
};
const boundToshiba = applyEbayOrderMatchToItem(
  toshibaItem,
  {
    order: toshibaOrder,
    lineItem: toshibaOrder.lineItems[0],
    matchScore: 200,
    matchKind: 'title',
  },
  'SmallBusiness'
);
assert.equal(boundToshiba.sellPrice, 25.52, 'books what the buyer paid');
assert.equal(boundToshiba.feeAmount, 7.7, 'tx + ads + label, not a 25% guess');
assert.equal(boundToshiba.saleProceeds?.transactionFeeEur, 2.06);
assert.equal(boundToshiba.saleProceeds?.adFeeEur, 2.74);
assert.equal(boundToshiba.saleProceeds?.shippingLabelEur, 2.9);
assert.equal(boundToshiba.saleProceeds?.netPayoutEur, 17.82);
assert.equal(boundToshiba.profit, 9.82, 'Bestelleinnahmen 17.82 − EK 8');

const picked = pickSellerHubMatch(
  [
    { orderId: '19-00000-11111', snippet: 'Kingston DDR4 16GB Laptop' },
    {
      orderId: '19-11447-34715',
      snippet: 'Crucial 16GB DDR5 4800MHz RAM CT16G48C40S5 Verkauft 138,93 €',
    },
    { orderId: '19-22222-33333', snippet: 'Samsung 980 1TB NVMe' },
  ],
  { title: 'Crucial 16GB DDR5 4800MHz RAM CT16G48C40S5', sku: 'CT16G48C40S5' }
);
assert.equal(picked.status, 'exact');
assert.equal(picked.match?.orderId, '19-11447-34715');

const byId = pickSellerHubMatch(
  [
    { orderId: '19-11447-34715', snippet: 'something else' },
    { orderId: '19-99999-00000', snippet: 'Crucial 16GB DDR5' },
  ],
  { orderId: '19-11447-34715' }
);
assert.equal(byId.status, 'exact');
assert.equal(byId.match?.orderId, '19-11447-34715');

const jsonPayout = harvestPayoutFromCapturedPayload({
  orderTotal: 25.52,
  transactionFee: -2.06,
  shippingLabelFee: -2.9,
  adFee: -2.74,
  netPayout: 17.82,
  buyer: {
    username: 'hdd-buyer',
    fullName: 'Thomas Müller',
    shippingAddress: {
      addressLine1: 'Musterweg 4',
      postalCode: '04109',
      city: 'Leipzig',
      countryCode: 'DE',
    },
  },
});
assert.equal(jsonPayout.buyerTotalEur, 25.52);
assert.equal(jsonPayout.transactionFeeEur, 2.06);
assert.equal(jsonPayout.shippingLabelEur, 2.9);
assert.equal(jsonPayout.adFeeEur, 2.74);
assert.equal(jsonPayout.netPayoutEur, 17.82);
assert.equal(jsonPayout.username, 'hdd-buyer');
assert.equal(jsonPayout.fullName, 'Thomas Müller');
assert.match(jsonPayout.address || '', /Musterweg 4/);
assert.match(jsonPayout.address || '', /Leipzig/);

const fromVision = payoutFromHubVisionJson(
  {
    buyerTotalEur: 25.52,
    transactionFeeEur: 2.06,
    adFeeEur: 2.74,
    shippingLabelEur: 2.9,
    netPayoutEur: 17.82,
    orderId: '03-12345-67890',
    username: 'hdd-buyer',
    fullName: 'Thomas Müller',
    address: 'Musterweg 4\n04109 Leipzig',
  },
  '03-12345-67890'
);
assert.equal(fromVision.buyerTotalEur, 25.52);
assert.equal(fromVision.transactionFeeEur, 2.06);
assert.equal(fromVision.shippingLabelEur, 2.9);
assert.equal(fromVision.netPayoutEur, 17.82);
assert.equal(fromVision.username, 'hdd-buyer');
assert.match(fromVision.address || '', /Musterweg 4/);

const HUB_BUYER = `
Bestellung 03-12345-67890
Käufer
hdd-buyer
Thomas Müller
Musterweg 4
04109 Leipzig
Deutschland

Lieferadresse
Thomas Müller
Musterweg 4
04109 Leipzig
Deutschland

Ihr Verkaufserlös
Gesamtbetrag
25,52 €
Verkaufskosten
Transaktionsgebühren
-2,06 €
Versandetikett
-2,90 €
Anzeigengebühr Basis
-2,74 €
Bestelleinnahmen
17,82 €
`;
const hubBuyer = parseEbaySellerHubPayoutText(HUB_BUYER);
assert.equal(hubBuyer.orderId, '03-12345-67890');
assert.equal(hubBuyer.username, 'hdd-buyer');
assert.equal(hubBuyer.fullName, 'Thomas Müller');
assert.match(hubBuyer.address || '', /Musterweg 4/);
assert.match(hubBuyer.address || '', /04109 Leipzig/);
assert.equal(hubBuyer.buyerTotalEur, 25.52);
assert.equal(hubBuyer.netPayoutEur, 17.82);

const junkBuyer = parseEbaySellerHubPayoutText(`
Käufer
":{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"Armen Abeli
Lieferadresse
Thomas Müller
Musterweg 4
04109 Leipzig
`);
assert.equal(junkBuyer.fullName, 'Thomas Müller');
assert.equal(junkBuyer.username, null);

assert.equal(parseGermanHubDate('1. Jul. 2025'), '2025-07-01');
assert.equal(parseGermanHubDate('01.07.2025'), '2025-07-01');
assert.equal(parseGermanHubDate('19. Aug 2026'), '2026-08-19');

const cancelled = extractHubOrderLifecycle('Storniert\nBestellung 03-11111-22222\n1. Jun. 2025\nErstatteter Betrag 25,52 €');
assert.equal(cancelled.status, 'cancelled');
assert.equal(cancelled.creationDate, '2025-06-01');
assert.equal(cancelled.refundEur, 25.52);
assert.equal(cancelled.cancelState, 'CANCELED');

const partial = extractHubOrderLifecycle('Teilweise erstattet\nGesamtbetrag 40,00 €\nErstattet 10,00 €');
assert.equal(partial.status, 'refunded_partial');
assert.equal(partial.refundEur, 10);

const titledDetails = extractHubListingTitle(`
Kaufdetails
Bestellnummer
03-15053-36524
Verkauft am
19. Aug. 2026
Artikel
Corsair Vengeance LPX 16GB (2x8GB) DDR4 3200MHz RAM Kit
Menge
1
Käufer
hdd-buyer
`);
assert.equal(titledDetails, 'Corsair Vengeance LPX 16GB (2x8GB) DDR4 3200MHz RAM Kit');

const titledSnippet = extractHubListingTitle('', {
  snippet: '03-15053-36524 · 19.08.2026 · 45,19 EUR · Corsair Vengeance LPX 16GB (2x8GB) · Erstattet',
});
assert.match(titledSnippet, /Corsair Vengeance LPX 16GB/);

const titledJson = extractHubListingTitle('', {
  orderId: '03-15053-36524',
  payloads: [
    {
      orderId: '03-15053-36524',
      lineItems: [{ title: 'Samsung 980 Pro 1TB NVMe SSD' }],
    },
  ],
});
assert.equal(titledJson, 'Samsung 980 Pro 1TB NVMe SSD');

const listRows = hubOrderRowsFromUnknown({
  orders: [
    { orderId: '03-11111-11111', title: 'Kingston Fury 16GB DDR4' },
    { orderId: '03-22222-22222', lineItems: [{ title: 'Intel Core i7-4790K' }] },
  ],
});
assert.equal(listRows.find((r) => r.orderId === '03-11111-11111')?.snippet, 'Kingston Fury 16GB DDR4');
assert.equal(listRows.find((r) => r.orderId === '03-22222-22222')?.snippet, 'Intel Core i7-4790K');

const unlabeled = extractHubListingTitle(`
Bestellung 03-15053-36524
Integral 16GB DDR4 3200MHz RAM Kit
Käufer
hdd-buyer
Ihr Verkaufserlös
Gesamtbetrag
45,19 €
`);
assert.equal(unlabeled, 'Integral 16GB DDR4 3200MHz RAM Kit');

assert.equal(extractHubListingTitle(SAMPLE), '');

const preFee = applyBusinessTxFeePolicy({ ...payout, transactionFeeEur: 11.29 }, '2025-06-30');
assert.equal(preFee.transactionFeeEur, 0);
const postFee = applyBusinessTxFeePolicy({ ...payout, transactionFeeEur: 11.29 }, '2025-07-01');
assert.equal(postFee.transactionFeeEur, 11.29);

const empty = parseEbaySellerHubPayoutText('hello world');
assert.equal(payoutLooksComplete(empty), false);

console.log('verify-ebay-seller-hub-payout: ok');
