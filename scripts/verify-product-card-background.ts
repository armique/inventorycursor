/**
 * Background product-card queue helpers.
 * Run: npx tsx scripts/verify-product-card-background.ts
 */
import assert from 'node:assert/strict';
import { resolveProductCardBatchCount } from '../services/productCardBackgroundQueue.ts';

assert.equal(resolveProductCardBatchCount(0), 1);
assert.equal(resolveProductCardBatchCount(-1), 1);
assert.equal(resolveProductCardBatchCount(1), 1);
assert.equal(resolveProductCardBatchCount(2), 2);
assert.equal(resolveProductCardBatchCount(3), 3);
assert.equal(resolveProductCardBatchCount(8), 3);

console.log('verify-product-card-background: all checks passed');
