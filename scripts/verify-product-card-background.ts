/**
 * Background product-card queue helpers.
 * Run: npx tsx scripts/verify-product-card-background.ts
 */
import assert from 'node:assert/strict';
import {
  resolveProductCardBatchCount,
  resolveProductCardJobCount,
} from '../services/productCardBackgroundQueue.ts';

assert.equal(resolveProductCardBatchCount(0), 1);
assert.equal(resolveProductCardBatchCount(-1), 1);
assert.equal(resolveProductCardBatchCount(1), 1);
assert.equal(resolveProductCardBatchCount(2), 2);
assert.equal(resolveProductCardBatchCount(3), 3);
assert.equal(resolveProductCardBatchCount(8), 3);

assert.equal(resolveProductCardJobCount(8, 1), 1);
assert.equal(resolveProductCardJobCount(0, 3), 3);
assert.equal(resolveProductCardJobCount(2), 2);

console.log('verify-product-card-background: all checks passed');
