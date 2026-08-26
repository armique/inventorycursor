/**
 * Single-line GPU checkout: sale row equals line sum but Bestelleinnahmen is lower (MSI 1080 Ti shape).
 * Run: npx tsx scripts/verify-hub-sell-single-line-fees.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import type { EbayOrderRecord } from '../services/ebayOrderIndex';
import { hubSaleColumnSplitForItem } from '../utils/hubOrderProceeds';

const order: EbayOrderRecord = {
  orderId: '27-14996-40678',
  creationDate: '2026-08-13',
  buyer: { fullName: 'Heiko Kraft' },
  lineItems: [
    {
      sku: '10087219826827',
      title: 'MSI GeForce GTX 1080 Ti GAMING X 11G',
      lineItemCost: 178.82,
      listingId: '267751738299',
    },
  ],
  grossTotal: 178.82,
  netTotal: 140.17,
  feeTotal: 38.65,
  shippingCost: 6.19,
  financialEvents: [
    {
      id: '1',
      date: '2026-08-13',
      kind: 'sale',
      amount: 178.82,
      transactionType: 'Bestellung',
      source: 'hub',
      importedAt: '2026-08-19T12:19:01.161Z',
    },
    {
      id: '2',
      date: '2026-08-13',
      kind: 'fee',
      amount: -11.18,
      transactionType: 'Transaktionsgebühren',
      source: 'hub',
      importedAt: '2026-08-19T12:19:01.161Z',
    },
    {
      id: '3',
      date: '2026-08-13',
      kind: 'fee',
      amount: -21.28,
      transactionType: 'Anzeigengebühr Basis',
      source: 'hub',
      importedAt: '2026-08-19T12:19:01.161Z',
    },
    {
      id: '4',
      date: '2026-08-13',
      kind: 'fee',
      amount: -6.19,
      transactionType: 'Versandetikett',
      source: 'hub',
      importedAt: '2026-08-19T12:19:01.161Z',
    },
  ],
  sources: ['hub'],
  importedAt: '2026-08-19T12:19:01.161Z',
};

const item: InventoryItem = {
  id: 'bulk-1786352555699-1',
  name: 'MSI GTX 1080 Ti',
  buyPrice: 80,
  buyDate: '2024-01-01',
  sellDate: '2026-08-13',
  sellPrice: 178.82,
  category: 'Components',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  ebayOrderId: '27-14996-40678',
  platformSold: 'ebay.de',
};

const split = hubSaleColumnSplitForItem(order, item, [item]);
assert.equal(split.totalEur, 178.82, 'Gesamtbetrag');
assert.equal(split.shippingEur, 6.19, 'Versandetikett');
assert.equal(split.ebayFeeEur + split.adFeeEur + split.otherFeeEur, 32.46, 'eBay fees');
assert.equal(split.netEur, 140.17, 'Bestelleinnahmen');
assert.notEqual(split.totalEur, split.netEur, 'total must differ from net');

console.log('verify-hub-sell-single-line-fees: ok', split);
