/**
 * Bulk Abrechnung match suggestions table.
 * Run: npx tsx scripts/verify-ebay-tx-bulk-match-suggestions.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import {
  buildEbayTxBulkMatchSuggestions,
  ebayTxBulkMatchSuggestionsToCsv,
} from '../utils/ebayTxBulkMatchSuggestions';
import type { EbayTxOrderLedger, EbayTxRow } from '../utils/ebayTransactionReport';

const row: EbayTxRow = {
  id: 'tx1',
  kind: 'order',
  typeRaw: 'Bestellung',
  orderId: '11-22222-33333',
  title: 'Corsair Vengeance RGB Pro 32GB DDR4',
  createdSort: '2026-03-15',
  createdAt: '15.03.2026',
  listingId: 'listing-99',
  grossEur: 62.19,
  itemSubtotalEur: 55,
  shippingEur: 7.19,
  netEur: 48,
  buyerUsername: 'buyer1',
};

const ledger: EbayTxOrderLedger = {
  orderId: '11-22222-33333',
  itemEur: 55,
  buyerShipEur: 7.19,
  grossEur: 62.19,
  fvfEur: -8,
  adsEur: -2,
  labelEur: -4,
  pocketEur: 48,
  otherEur: 0,
};

const item: InventoryItem = {
  id: 'inv1',
  name: 'Corsair Vengeance RGB Pro 32GB',
  buyPrice: 25,
  buyDate: '2026-01-01',
  sellDate: '2026-08-23',
  sellPrice: 62.19,
  status: ItemStatus.SOLD,
  category: 'Components',
  ebayListingId: 'listing-99',
};

const ledgers = new Map([[row.orderId, ledger]]);
const suggestions = buildEbayTxBulkMatchSuggestions([item], [row], ledgers);
assert.equal(suggestions.length, 1);
assert.equal(suggestions[0]?.confidence, 'high');
assert.equal(suggestions[0]?.csvSellDate, '2026-03-15');
assert.equal(suggestions[0]?.suggestedItemId, 'inv1');

const csv = ebayTxBulkMatchSuggestionsToCsv(suggestions);
assert.ok(csv.includes('11-22222-33333'));
assert.ok(csv.includes('2026-03-15'));

console.log('verify-ebay-tx-bulk-match-suggestions: ok');
