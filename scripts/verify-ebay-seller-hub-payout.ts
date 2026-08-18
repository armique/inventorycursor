/**
 * Seller Hub payout parser: buyer total, eBay fee, ads, label, net remainder.
 * Run: npx tsx scripts/verify-ebay-seller-hub-payout.ts
 */
import assert from 'node:assert/strict';
import {
  parseEbaySellerHubPayoutText,
  pickSellerHubMatch,
  payoutLooksComplete,
} from '../lib/ebaySellerHubPayout.js';
import { saleFieldsFromHubPayout } from '../utils/ebaySellerHubSaleFields';

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
assert.equal(fields.feeAmount, 25.01);
assert.equal(fields.hasFee, true);
assert.equal(fields.sellerPaidShipping, true);
assert.equal(fields.sellerShippingAmount, 6.19);
assert.equal(fields.saleProceeds.netPayoutEur, 107.73);
assert.equal(fields.saleProceeds.source, 'ebay_seller_hub');

const netCheck = 138.93 - 11.29 - 13.72 - 6.19;
assert.equal(Math.round(netCheck * 100) / 100, 107.73);

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

const empty = parseEbaySellerHubPayoutText('hello world');
assert.equal(payoutLooksComplete(empty), false);

console.log('verify-ebay-seller-hub-payout: ok');
