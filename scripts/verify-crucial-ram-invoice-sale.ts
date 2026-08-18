/**
 * Run: npx tsx scripts/verify-crucial-ram-invoice-sale.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import { computeItemProfitBeforeOverhead, roundMoney } from '../services/financialAggregation';
import {
  applyCrucialRamInvoiceSaleFix,
  CRUCIAL_RAM_AD_FEE,
  CRUCIAL_RAM_BUYER_ITEM,
  CRUCIAL_RAM_BUYER_SHIPPING,
  CRUCIAL_RAM_BUYER_TOTAL,
  CRUCIAL_RAM_FEES,
  CRUCIAL_RAM_OLD_NET,
  CRUCIAL_RAM_TX_FEE,
  isCrucialRamLegacyNetSale,
} from '../utils/crucialRamInvoiceSaleFix';
import { getInvoiceItemAmounts } from '../utils/invoiceAmounts';

const buy = 40;
const legacy: InventoryItem = {
  id: 'ram-legacy',
  name: 'Crucial 16GB DDR5 4800MHz RAM CT16G48C40S5',
  buyPrice: buy,
  buyDate: '2024-04-01',
  sellPrice: CRUCIAL_RAM_OLD_NET,
  sellDate: '2024-05-08',
  category: 'Components',
  subCategory: 'RAM',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  platformSold: 'ebay.de',
};

assert.equal(isCrucialRamLegacyNetSale(legacy), true, 'legacy net sale matches');
assert.equal(
  roundMoney(CRUCIAL_RAM_BUYER_TOTAL - CRUCIAL_RAM_BUYER_SHIPPING - CRUCIAL_RAM_TX_FEE - CRUCIAL_RAM_AD_FEE),
  CRUCIAL_RAM_OLD_NET,
  'Seller Hub totals reconcile to Bestelleinnahmen'
);

const { items, changed } = applyCrucialRamInvoiceSaleFix([legacy], 'SmallBusiness');
assert.equal(changed, true, 'patch applied');
const patched = items[0];
assert.equal(patched.sellPrice, CRUCIAL_RAM_BUYER_TOTAL, 'invoice sell is buyer total');
assert.equal(patched.feeAmount, CRUCIAL_RAM_FEES, 'tx + ad fees on cost side');
assert.equal(patched.sellerShippingAmount, CRUCIAL_RAM_BUYER_SHIPPING, 'label as shipping cost');
const invoice = getInvoiceItemAmounts(patched);
assert.equal(invoice.itemGross, CRUCIAL_RAM_BUYER_ITEM, 'invoice line is item without shipping');
assert.equal(invoice.shippingGross, CRUCIAL_RAM_BUYER_SHIPPING, 'invoice Versand line');
assert.equal(invoice.totalGross, CRUCIAL_RAM_BUYER_TOTAL, 'Gesamtbetrag includes shipping');
assert.equal(
  computeItemProfitBeforeOverhead(patched, 'SmallBusiness'),
  CRUCIAL_RAM_OLD_NET - buy,
  'profit still matches former net payout'
);

const again = applyCrucialRamInvoiceSaleFix(items, 'SmallBusiness');
assert.equal(again.changed, false, 'idempotent');

const kit: InventoryItem = {
  ...legacy,
  id: 'kit',
  name: 'Crucial RAM 32GB Kit CT2K16G48C40S5',
};
assert.equal(isCrucialRamLegacyNetSale(kit), false, 'kit SKU skipped');

const noSku: InventoryItem = {
  ...legacy,
  id: 'ram-title',
  name: 'Crucial 16GB DDR5 4800MHz RAM',
};
assert.equal(isCrucialRamLegacyNetSale(noSku), true, 'eBay title without SKU still matches');

console.log('verify-crucial-ram-invoice-sale: ok');
