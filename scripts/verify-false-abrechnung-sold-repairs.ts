/**
 * Audit / dry-run false Abrechnung sold links (e.g. Aug 31 cluster).
 * Run: npx tsx scripts/verify-false-abrechnung-sold-repairs.ts
 * Apply in app: eBay Abrechnung → "Repair false sold links"
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import {
  countFalseAbrechnungSoldRepairs,
  planFalseAbrechnungSoldRepairs,
  stripMistakenAbrechnungSoldLink,
} from '../utils/repairFalseAbrechnungSoldLinks';
import { itemLinkedToEbayTxRow } from '../utils/ebayTxRowLink';
import { ebayTxRowLineKey, type EbayTxRow } from '../utils/ebayTransactionReport';

const row = (partial: Partial<EbayTxRow>): EbayTxRow => ({
  id: 'r1',
  createdAt: '2026-08-31',
  createdSort: '2026-08-31',
  typeRaw: 'Bestellung',
  kind: 'order',
  orderId: '05-11111-22222',
  buyerUsername: 'buyer',
  buyerName: 'Buyer',
  city: '',
  country: 'DE',
  zip: '',
  title: 'GeForce GTX 770',
  listingId: '267721370874',
  sku: '',
  itemSubtotalEur: 40,
  shippingEur: 0,
  grossEur: 40,
  netEur: 35,
  ...partial,
});

const bundle: InventoryItem = {
  id: 'pc-1',
  name: 'Test PC',
  buyPrice: 200,
  category: 'PC',
  status: ItemStatus.IN_STOCK,
  isPC: true,
  componentIds: ['part-gpu'],
  comment1: '',
  comment2: '',
};

const falseGpu: InventoryItem = {
  id: 'part-gpu',
  name: 'GeForce GTX 770',
  buyPrice: 40,
  category: 'GPU',
  status: ItemStatus.SOLD,
  sellDate: '2026-08-31',
  sellPrice: 55,
  ebayOrderId: '05-11111-22222',
  platformSold: 'ebay.de',
  paymentType: 'ebay.de',
  saleProceeds: { capturedAt: '', source: 'ebay_order', netPayoutEur: 50 },
  comment1: '',
  comment2: '',
};

const items = [bundle, falseGpu];
const abrechnungRows = [row({})];

assert.equal(itemLinkedToEbayTxRow(falseGpu, abrechnungRows[0]), true);

const planValid = planFalseAbrechnungSoldRepairs(items, abrechnungRows);
assert.equal(planValid.updates.length, 0, 'strict line match must not be repaired');

const wrongOrderGpu: InventoryItem = {
  ...falseGpu,
  id: 'part-wrong',
  ebayOrderId: '05-99999-99999',
  ebayListingId: '111',
};
const planWrong = planFalseAbrechnungSoldRepairs([bundle, wrongOrderGpu], abrechnungRows);
assert.equal(planWrong.updates.length, 1);
assert.equal(planWrong.updates[0].status, ItemStatus.IN_STOCK);
assert.equal(planWrong.updates[0].sellDate, undefined);

const orphanPart: InventoryItem = {
  ...falseGpu,
  ebayOrderId: undefined,
  saleProceeds: undefined,
  sellPrice: 50,
};
const planOrphan = planFalseAbrechnungSoldRepairs([bundle, orphanPart], abrechnungRows, {
  requireAbrechnungSource: false,
});
assert.equal(planOrphan.updates.length, 1);
assert.equal(planOrphan.updates[0].parentContainerId, 'pc-1');
assert.equal(planOrphan.updates[0].status, ItemStatus.IN_COMPOSITION);

const stripped = stripMistakenAbrechnungSoldLink(falseGpu);
assert.equal(stripped.status, ItemStatus.IN_STOCK);
assert.equal(stripped.ebayOrderId, undefined);

assert.equal(
  countFalseAbrechnungSoldRepairs([bundle, wrongOrderGpu], abrechnungRows, { sellDate: '2026-08-31' }),
  1
);

console.log('verify-false-abrechnung-sold-repairs: ok');
