/**
 * Verify the dealwatch-runtime/server.js side of the Buy Helper bridge:
 * buildBuyHelperQuoteQuery() and buildQuoteBucket(). No network calls —
 * these are the pure pieces around the /api/buy-helper/quote route.
 * Run: npx tsx scripts/verify-buy-helper-quote-bridge.ts
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Dealwatch = require('../dealwatch-runtime/server.js');
const { buildBuyHelperQuoteQuery, buildQuoteBucket } = dealwatchRuntime;

console.log('\n=== buildBuyHelperQuoteQuery ===');

const ebayParams = new URLSearchParams({ query: 'RTX 3070', minPrice: '10', maxPrice: '250', categoryId: '12345', kaCategory: 'pc-zubehoer' });
const ebayQuery = buildBuyHelperQuoteQuery(ebayParams, 'ebay');
console.log('ebay query:', ebayQuery);
assert.equal(ebayQuery.marketplace, 'ebay');
assert.equal(ebayQuery.search, 'RTX 3070');
assert.equal(ebayQuery.minPrice, 10);
assert.equal(ebayQuery.maxPrice, 250);
assert.equal(ebayQuery.categoryId, '12345', 'categoryId must pass through for ebay');
assert.equal(ebayQuery.kaCategory, 'all', 'kaCategory must be forced to "all" for ebay (not applicable)');

const kaParams = new URLSearchParams({ query: 'RTX 3070', kaCategory: 'pc-zubehoer', categoryId: '12345' });
const kaQuery = buildBuyHelperQuoteQuery(kaParams, 'kleinanzeigen');
console.log('kleinanzeigen query:', kaQuery);
assert.equal(kaQuery.marketplace, 'kleinanzeigen');
assert.equal(kaQuery.categoryId, '', 'categoryId must be dropped for kleinanzeigen (eBay-only concept)');
assert.equal(kaQuery.kaCategory, 'pc-zubehoer', 'kaCategory must pass through for kleinanzeigen');

const bareParams = new URLSearchParams({ query: 'RTX 3070' });
const bareQuery = buildBuyHelperQuoteQuery(bareParams, 'ebay');
assert.equal(bareQuery.maxPrice, 3000, 'must fall back to DEFAULT_BUY_HELPER_QUOTE_MAX_PRICE when unset');
assert.equal(bareQuery.minPrice, 1, 'must fall back to minPrice=1 when unset');
console.log('bare query (defaults):', bareQuery);

console.log('\n=== buildQuoteBucket ===');

function item(total: number, lotType: string) {
  return { id: `x|${Math.random()}`, total, lotType };
}

const mixed = [
  item(50, 'component'),
  item(55, 'component'),
  item(60, 'component'),
  item(900, 'whole_pc'),
  item(5, 'accessory_only'),
];
const bucket = buildQuoteBucket(mixed);
console.log('mixed bucket:', bucket);
assert.ok(bucket, 'bucket must not be null when component items exist');
assert.equal(bucket.count, 3, 'must count only component items');
assert.equal(bucket.median, 55);
assert.equal(bucket.low, 50);
assert.equal(bucket.high, 60);
assert.equal(bucket.items.length, 3, 'items must be filtered to component-only');
assert.ok(bucket.items.every((i: { lotType: string }) => i.lotType === 'component'));

const noComponents = [item(900, 'whole_pc'), item(5, 'accessory_only')];
assert.equal(buildQuoteBucket(noComponents), null, 'must return null when there are zero component items');

const empty = buildQuoteBucket([]);
assert.equal(empty, null, 'must return null for an empty array');

const noArg = buildQuoteBucket(undefined);
assert.equal(noArg, null, 'must handle undefined input without throwing');

console.log('\nverify-buy-helper-quote-bridge: ok');
