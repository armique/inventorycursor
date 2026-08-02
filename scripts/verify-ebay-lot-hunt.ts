/**
 * eBay Lot Hunt import + agent payload.
 * Run: npx tsx scripts/verify-ebay-lot-hunt.ts
 */
import assert from 'node:assert/strict';
import {
  buildEbaySearchUrl,
  exportEbayLotHuntAgentPayload,
  type EbayLotHuntQuery,
} from '../utils/ebayLotHunt';

const q: EbayLotHuntQuery = {
  query: 'RTX 3070 8GB',
  priceMin: 150,
  priceMax: 280,
  maxKeep: 10,
  marketplace: 'ebay.de',
  listingType: 'bin',
};

const url = buildEbaySearchUrl(q);
assert.match(url, /ebay\.de\/sch/);
assert.match(url, /RTX/);
assert.match(url, /_udlo=150/);
assert.match(url, /_udhi=280/);
assert.match(url, /LH_BIN=1/);

const payload = exportEbayLotHuntAgentPayload(q);
assert.equal(payload.mode, 'ebay_lot_hunt');
assert.equal(payload.query.query, 'RTX 3070 8GB');
assert.match(payload.safety.rule, /Do not buy/i);

console.log('OK: ebay lot hunt search URL + agent payload');
console.log('\nAll ebay-lot-hunt checks passed.');
