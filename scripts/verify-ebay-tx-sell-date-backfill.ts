/**
 * Backfill sell dates for items already linked via Abrechnung Match.
 * Run: npx tsx scripts/verify-ebay-tx-sell-date-backfill.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import { backfillEbayTxLinkedSellDates } from '../utils/backfillEbayTxLinkedSellDates';
import type { EbayTxRow } from '../utils/ebayTransactionReport';

const row: EbayTxRow = {
  id: 'tx1',
  kind: 'order',
  typeRaw: 'Bestellung',
  orderId: '11-11111-11111',
  title: 'Test PSU',
  createdSort: '2026-04-02',
  createdAt: '02.04.2026',
  grossEur: 80,
  itemSubtotalEur: 75,
  shippingEur: 5,
  netEur: 60,
};

const linked: InventoryItem = {
  id: 'i1',
  name: 'Test PSU',
  buyPrice: 30,
  buyDate: '2026-01-01',
  sellDate: '2026-01-15',
  containerSoldDate: '2025-12-01',
  sellPrice: 80,
  status: ItemStatus.SOLD,
  category: 'Components',
  ebayOrderId: '11-11111-11111',
};

const alreadyOk: InventoryItem = {
  ...linked,
  id: 'i2',
  sellDate: '2026-04-02',
  containerSoldDate: undefined,
};

const missing: InventoryItem = {
  ...linked,
  id: 'i3',
  ebayOrderId: '99-99999-99999',
};

const listingOnly: InventoryItem = {
  id: 'i4',
  name: 'Integral 32GB',
  buyPrice: 20,
  buyDate: '2025-01-01',
  sellDate: '2025-02-26',
  sellPrice: 39,
  status: ItemStatus.SOLD,
  category: 'Components',
  ebayListingId: '267172948074',
};

const listingRow: EbayTxRow = {
  id: 'tx2',
  kind: 'order',
  typeRaw: 'Bestellung',
  orderId: '06-12769-85233',
  title: 'Integral 32GB',
  listingId: '267172948074',
  createdSort: '2025-02-27',
  createdAt: '27.02.2025',
  grossEur: 45.19,
  itemSubtotalEur: 39,
  shippingEur: 6.19,
  netEur: 39,
};

const { updates, unchanged, missingInCsv } = backfillEbayTxLinkedSellDates(
  [linked, alreadyOk, missing, listingOnly],
  [row, listingRow]
);

assert.equal(updates.length, 2);
assert.equal(updates.find((u) => u.id === 'i1')?.sellDate, '2026-04-02');
assert.equal(updates.find((u) => u.id === 'i4')?.sellDate, '2025-02-27');
assert.equal(unchanged, 1);
assert.deepEqual(missingInCsv, ['99-99999-99999']);

console.log('verify-ebay-tx-sell-date-backfill: ok');
