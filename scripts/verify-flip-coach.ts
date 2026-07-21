/**
 * Verify Flip Coach pocket ↔ list price math.
 * Run: npx tsx scripts/verify-flip-coach.ts
 */
import assert from 'node:assert/strict';
import {
  listPricesForPocket,
  maxBuyForEbayFlip,
  maxBuyForKleinFlip,
  pocketFromEbayListPrice,
  totalEbayFeePct,
} from '../utils/flipCoach';

assert.equal(totalEbayFeePct({ ebayFeePct: 10, ebayAdsPct: 12.5 }), 22.5);

const lists = listPricesForPocket(100, 25);
assert.equal(lists.kleinanzeigen, 100);
assert.equal(lists.ebay, 133.33); // 100 / 0.75

assert.equal(pocketFromEbayListPrice(133.33, 25), 100);

assert.equal(maxBuyForKleinFlip(100, 30), 70);
assert.equal(maxBuyForEbayFlip(133.33, 25, 30), 70);

console.log('verify-flip-coach: ok');
