/**
 * PC Bundle titles must not share an eBay listing just because both say "PC Bundle".
 * Run: npx tsx scripts/verify-ebay-bundle-match.ts
 */
import assert from 'node:assert/strict';
import {
  extractModelTokens,
  listingHardwareCompatible,
  scoreListingTitleMatch,
} from '../utils/ebayListingMatch';

const a10 = 'PC Bundle — A10-6700';
const i7 = 'PC Bundle: ASRock H97 Pro4, Intel Core i7-4790K, 8GB DDR3 RAM';

assert.ok(
  extractModelTokens(a10).some((k) => k.includes('a10') || k.includes('6700')),
  'A10-6700 must produce a hardware token',
);
assert.equal(listingHardwareCompatible(a10, i7), false);
assert.equal(scoreListingTitleMatch(a10, i7), 0);

assert.ok(listingHardwareCompatible(a10, 'PC Bundle A10-6700 8GB'));
assert.ok(scoreListingTitleMatch(a10, 'PC Bundle A10-6700 8GB') >= 40);

console.log('verify-ebay-bundle-match: all checks passed');
