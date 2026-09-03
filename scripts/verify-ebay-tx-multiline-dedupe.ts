/**
 * Verify multi-item Abrechnung Bestellung dedupe + line keys + pocket/refund.
 * Run: npx tsx scripts/verify-ebay-tx-multiline-dedupe.ts
 */
import assert from 'node:assert/strict';
import {
  classifyEbayTxOrderRefundState,
  dedupeEbayTxBestellungRows,
  ebayTxOrderRowDisplayPocket,
  ebayTxOrderSellDateForRow,
  allocateOrderPocketByItemShare,
  ebayTxRowLineKey,
  buildEbayTxOrderLedgers,
  type EbayTxRow,
} from '../utils/ebayTransactionReport';
import { findInventoryLinkedToEbayTxRow, itemLinkedToEbayTxRow, buildLinkedByOrderMap, findInventoryClosedSaleForEbayTxRow } from '../utils/ebayTxRowLink';
import { linkInventoryItemToEbayTx, abrechnungLinkResync } from '../utils/linkInventoryItemToEbayTx';
import { ItemStatus, type InventoryItem } from '../types';

const base = (partial: Partial<EbayTxRow>): EbayTxRow => ({
  id: 'x',
  createdAt: '2026-08-30',
  createdSort: '2026-08-30',
  typeRaw: 'Bestellung',
  kind: 'order',
  orderId: '05-15107-73127',
  buyerUsername: 'jobr_1813',
  buyerName: 'Josef Braun',
  city: '',
  zip: '',
  country: '',
  netEur: 50,
  payoutDate: '',
  payoutId: '',
  payoutMethod: '',
  payoutStatus: '',
  listingId: '',
  transactionId: '',
  title: '',
  sku: '',
  quantity: 1,
  itemSubtotalEur: 50,
  shippingEur: null,
  sellerTaxEur: null,
  ebayTaxEur: null,
  fixedFeeEur: null,
  variableFeeEur: null,
  otherOrderFeeEur: null,
  grossEur: 50,
  currency: 'EUR',
  reference: '',
  description: '',
  ...partial,
});

const feeRows: EbayTxRow[] = [
  base({ id: 'label', kind: 'label', typeRaw: 'Versandetikett', title: '', netEur: -7.69, grossEur: -7.69 }),
  base({
    id: 'ad1',
    kind: 'other_fee',
    typeRaw: 'Anzeigengebühr',
    listingId: '267734080020',
    netEur: -4.5,
    grossEur: -4.5,
    description: 'Basis-Anzeigen',
  }),
  base({
    id: 'ad2',
    kind: 'other_fee',
    typeRaw: 'Anzeigengebühr',
    listingId: '267721370874',
    netEur: -3.82,
    grossEur: -3.82,
    description: 'Basis-Anzeigen',
  }),
  base({
    id: 'ad3',
    kind: 'other_fee',
    typeRaw: 'Anzeigengebühr',
    listingId: '267729622585',
    netEur: -3.19,
    grossEur: -3.19,
    description: 'Basis-Anzeigen',
  }),
];

const rows: EbayTxRow[] = [
  base({ id: 'blank', title: '', itemSubtotalEur: 156.3, shippingEur: 37.14, grossEur: 193.44, netEur: 142 }),
  base({
    id: 'ram',
    title: 'G.SKILL Ripjaws X 16GB (4x4GB)',
    listingId: '267734080020',
    itemSubtotalEur: 156.3,
    shippingEur: 37.14,
    grossEur: 193.44,
    netEur: 142,
  }),
  base({
    id: 'gtx',
    title: '2GB Asus GeForce GTX 770',
    listingId: '267721370874',
    itemSubtotalEur: 156.3,
    shippingEur: 37.14,
    grossEur: 193.44,
    netEur: 142,
  }),
  base({
    id: 'hd',
    title: 'Sapphire AMD Radeon HD 6870',
    listingId: '267729622585',
    itemSubtotalEur: 156.3,
    shippingEur: 37.14,
    grossEur: 193.44,
    netEur: 142,
  }),
  base({
    id: 'api-05-15107-73127',
    title: 'G.SKILL + GTX 770 + HD 6870',
    itemSubtotalEur: 156.3,
    shippingEur: 37.14,
    grossEur: 193.44,
    netEur: 142,
  }),
  ...feeRows,
];

const deduped = dedupeEbayTxBestellungRows(rows);
const orders = deduped.filter((r) => r.kind === 'order');
assert.equal(orders.length, 3, `expected 3 Bestellung rows, got ${orders.length}: ${orders.map((r) => r.id).join(',')}`);
assert.ok(orders.every((r) => r.listingId), 'each Bestellung should keep listingId');
assert.ok(deduped.some((r) => r.kind === 'other_fee'), 'fee rows preserved');

const ledger = buildEbayTxOrderLedgers(deduped).get('05-15107-73127')!;
assert.ok(Math.abs(ledger.itemEur - 156.3) < 0.02, `item should count once, got ${ledger.itemEur}`);
assert.ok(Math.abs(ledger.buyerShipEur - 37.14) < 0.02, `ship should count once, got ${ledger.buyerShipEur}`);
assert.ok(ledger.pocketEur > 0, `order pocket should be positive, got ${ledger.pocketEur}`);

for (const row of orders) {
  assert.equal(classifyEbayTxOrderRefundState(ledger, row, 0), 'none', `${row.id} should not be refunded`);
  const pocket = ebayTxOrderRowDisplayPocket(row, ledger, deduped);
  assert.ok(pocket != null && pocket > 0, `${row.id} display pocket should be positive, got ${pocket}`);
}

const pocketSum = orders.reduce(
  (sum, row) => sum + (ebayTxOrderRowDisplayPocket(row, ledger, deduped) ?? 0),
  0
);
assert.ok(
  Math.abs(pocketSum - ledger.pocketEur) < 0.05,
  `line pockets should sum to order pocket (${pocketSum} vs ${ledger.pocketEur})`
);
assert.ok(
  orders.every((row, i) => {
    const expected = allocateOrderPocketByItemShare(orders, row, ledger);
    const actual = ebayTxOrderRowDisplayPocket(row, ledger, deduped)!;
    return Math.abs(expected - actual) < 0.02;
  }),
  'each line pocket should match item-share allocation'
);

// Realistic CSV: per-line rows with blank net (eBay quirk) — must not show false refund.
const perLineCsv: EbayTxRow[] = [
  base({
    id: 'ram2',
    title: 'G.SKILL Ripjaws X 16GB (4x4GB)',
    listingId: '267734080020',
    itemSubtotalEur: 78.15,
    shippingEur: 18.57,
    grossEur: null,
    netEur: null,
  }),
  base({
    id: 'gtx2',
    title: '2GB Asus GeForce GTX 770',
    listingId: '267721370874',
    itemSubtotalEur: 78.15,
    shippingEur: 18.57,
    grossEur: null,
    netEur: null,
  }),
  base({
    id: 'hd2',
    title: 'Sapphire AMD Radeon HD 6870',
    listingId: '267729622585',
    itemSubtotalEur: 78.15,
    shippingEur: 18.57,
    grossEur: null,
    netEur: null,
  }),
  ...feeRows,
];
const perLineDeduped = dedupeEbayTxBestellungRows(perLineCsv);
const perLineLedger = buildEbayTxOrderLedgers(perLineDeduped).get('05-15107-73127')!;
assert.ok(perLineLedger.pocketEur > 0, `per-line blank-net pocket should be positive, got ${perLineLedger.pocketEur}`);
for (const row of perLineDeduped.filter((r) => r.kind === 'order')) {
  assert.equal(classifyEbayTxOrderRefundState(perLineLedger, row, 0), 'none');
}

const gpu: InventoryItem = {
  id: 'inv-gtx',
  name: '2GB Asus GeForce GTX 770',
  buyPrice: 40,
  category: 'GPU',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  ebayOrderId: '05-15107-73127',
  ebayListingId: '267721370874',
  ebayOrderLineKey: ebayTxRowLineKey(orders.find((r) => r.listingId === '267721370874')!),
};

const ram: InventoryItem = {
  id: 'inv-ram',
  name: 'G.SKILL Ripjaws',
  buyPrice: 20,
  category: 'RAM',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  ebayOrderId: '05-15107-73127',
  ebayListingId: '267734080020',
};

const gtxRow = orders.find((r) => r.listingId === '267721370874')!;
const ramRow = orders.find((r) => r.listingId === '267734080020')!;
const hdRow = orders.find((r) => r.listingId === '267729622585')!;
assert.equal(findInventoryLinkedToEbayTxRow([gpu, ram], gtxRow)?.id, 'inv-gtx');
assert.equal(findInventoryLinkedToEbayTxRow([gpu, ram], ramRow)?.id, 'inv-ram');
assert.equal(findInventoryLinkedToEbayTxRow([gpu, ram], hdRow), null, 'third line must stay unlinked until explicitly matched');
assert.equal(itemLinkedToEbayTxRow(gpu, ramRow), false, 'GPU must not count as linked to RAM line');
assert.equal(itemLinkedToEbayTxRow(ram, gtxRow), false, 'RAM must not count as linked to GPU line');

const hd: InventoryItem = {
  id: 'inv-hd',
  name: 'Sapphire AMD Radeon HD 6870',
  buyPrice: 30,
  category: 'GPU',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  ebayOrderId: '05-15107-73127',
  ebayListingId: '267729622585',
  ebayOrderLineKey: ebayTxRowLineKey(hdRow),
};
assert.equal(findInventoryLinkedToEbayTxRow([gpu, ram, hd], hdRow)?.id, 'inv-hd');
assert.equal(findInventoryLinkedToEbayTxRow([gpu, ram, hd], gtxRow)?.id, 'inv-gtx');

const inStockGpu: InventoryItem = {
  id: 'inv-gtx-stock',
  name: '2GB Asus GeForce GTX 770',
  buyPrice: 40,
  category: 'GPU',
  status: ItemStatus.IN_STOCK,
  comment1: '',
  comment2: '',
};
const linkedGtx = linkInventoryItemToEbayTx(inStockGpu, gtxRow, ledger, 'SmallBusiness', {
  allRows: deduped,
});
assert.equal(linkedGtx.status, ItemStatus.SOLD, 'Abrechnung link must mark in-stock item sold');
assert.equal(linkedGtx.sellDate, '2026-08-30', 'sell date from CSV row');
assert.equal(linkedGtx.ebayOrderId, '05-15107-73127');
assert.equal(linkedGtx.ebayListingId, '267721370874');
assert.ok(linkedGtx.saleProceeds?.buyerTotalEur != null && linkedGtx.saleProceeds.buyerTotalEur > 0);

const blankDateRow: EbayTxRow = {
  ...gtxRow,
  id: 'gtx-no-date',
  createdSort: '',
  createdAt: '',
};
const linkedNoDate = linkInventoryItemToEbayTx(inStockGpu, blankDateRow, ledger, 'SmallBusiness', {
  allRows: deduped,
});
assert.equal(
  linkedNoDate.sellDate,
  ebayTxOrderSellDateForRow(gtxRow, deduped),
  'blank line inherits sell date from sibling Bestellung row'
);

const halfLinked: InventoryItem = {
  ...inStockGpu,
  id: 'inv-half',
  ebayOrderId: '05-15107-73127',
  ebayListingId: '267721370874',
  status: ItemStatus.IN_STOCK,
};
const repaired = abrechnungLinkResync(halfLinked, gtxRow, ledger, 'SmallBusiness', deduped);
assert.ok(repaired, 'half-linked row (order id only) needs resync');
assert.equal(repaired!.status, ItemStatus.SOLD);
assert.equal(repaired!.sellDate, '2026-08-30');

const restockedAfterRefund: InventoryItem = {
  id: 'bundle-restocked',
  name: 'Gaming PC Bundle',
  isBundle: true,
  buyPrice: 164.42,
  category: 'PC',
  status: ItemStatus.IN_STOCK,
  comment1: '',
  comment2: '',
  ebayListingId: '276603456789',
  ebaySaleCycles: [
    {
      id: 'cycle-refund-1',
      closedAt: '2026-09-02T12:00:00.000Z',
      reason: 'erstattet',
      reasonLabel: 'Erstattet',
      sellDate: '2026-08-15',
      sellPrice: 199,
      ebayOrderId: '01-14946-82253',
      ebayListingId: '276603456789',
      buyPriceAtClose: 140.44,
      refundKind: 'full',
    },
  ],
};
const refundOrderRow: EbayTxRow = {
  ...base({ orderId: '01-14946-82253', listingId: '276603456789', title: 'Gaming PC Bundle' }),
  id: 'refund-order-row',
};
assert.equal(
  findInventoryLinkedToEbayTxRow([restockedAfterRefund], refundOrderRow),
  null,
  'restocked item must not stay live-linked via archived sale cycle'
);
assert.equal(
  findInventoryClosedSaleForEbayTxRow([restockedAfterRefund], refundOrderRow)?.id,
  'bundle-restocked',
  'closed sale cycles must still resolve for Abrechnung handled state'
);
assert.equal(
  buildLinkedByOrderMap([restockedAfterRefund]).has('01-14946-82253'),
  false,
  'fee-row linked map stays live-order only'
);

console.log('verify-ebay-tx-multiline-dedupe: ok');
