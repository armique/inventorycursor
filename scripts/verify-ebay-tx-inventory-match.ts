/**
 * Abrechnung match picker should rank same sell date / close price above weak title-only hits.
 * Run: npx tsx scripts/verify-ebay-tx-inventory-match.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import {
  ebayTxDateProximityScore,
  ebayTxPriceProximityScore,
  findEbayTxInventoryMatches,
} from '../utils/ebayTxInventoryMatch';
import type { EbayTxRow } from '../utils/ebayTransactionReport';
import { ebayTxOrderSellDate } from '../utils/ebayTransactionReport';
import { linkInventoryItemToEbayTx } from '../utils/linkInventoryItemToEbayTx';

const row: EbayTxRow = {
  id: 'tx1',
  kind: 'order',
  typeRaw: 'Bestellung',
  orderId: '11-22222-33333',
  title: 'Corsair Vengeance RGB Pro 32GB DDR4',
  createdSort: '2026-03-15',
  createdAt: '15.03.2026',
  grossEur: 62.19,
  itemSubtotalEur: 55,
  shippingEur: 7.19,
  netEur: 48,
};

const wrongTitleSameDay: InventoryItem = {
  id: 'a',
  name: 'Random unrelated RAM stick',
  buyPrice: 20,
  buyDate: '2026-01-01',
  sellDate: '2026-03-15',
  sellPrice: 62.19,
  status: ItemStatus.SOLD,
  category: 'Components',
};

const goodTitleWrongDay: InventoryItem = {
  id: 'b',
  name: 'Corsair Vengeance RGB Pro 32GB DDR4 3200MHz',
  buyPrice: 25,
  buyDate: '2026-01-01',
  sellDate: '2026-01-10',
  sellPrice: 40,
  status: ItemStatus.SOLD,
  category: 'Components',
};

const goodTitleSameDay: InventoryItem = {
  id: 'c',
  name: 'Corsair Vengeance RGB Pro 32GB DDR4 3200MHz',
  buyPrice: 25,
  buyDate: '2026-01-01',
  sellDate: '2026-03-15',
  sellPrice: 62.19,
  status: ItemStatus.SOLD,
  category: 'Components',
};

assert.equal(ebayTxDateProximityScore('2026-03-15', '2026-03-15'), 600);
assert.equal(ebayTxPriceProximityScore(62.19, 62.19), 550);

const matches = findEbayTxInventoryMatches(
  [wrongTitleSameDay, goodTitleWrongDay, goodTitleSameDay],
  row,
  null,
  '',
  8
);

assert.ok(matches.length >= 2, 'expected at least two suggestions');
assert.equal(matches[0]?.item.id, 'c', 'same day + close price + title should rank first');
assert.ok(
  matches.findIndex((m) => m.item.id === 'a') < matches.findIndex((m) => m.item.id === 'b'),
  'same-day/price item should rank above title-only on wrong date'
);

const linked = linkInventoryItemToEbayTx(
  { ...goodTitleWrongDay, sellDate: '2026-01-10', containerSoldDate: '2025-12-01' },
  row,
  null,
  'SmallBusiness'
);
assert.equal(linked.sellDate, '2026-03-15', 'link must overwrite sellDate from CSV');
assert.equal(linked.containerSoldDate, undefined, 'link must clear inherited containerSoldDate');
assert.equal(ebayTxOrderSellDate({ createdAt: '15.03.2026', createdSort: '' }), '2026-03-15');

console.log('verify-ebay-tx-inventory-match: ok');
