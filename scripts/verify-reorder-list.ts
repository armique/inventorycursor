/**
 * Verify list reorder helper used by photo thumbnail drag.
 * Run: npx tsx scripts/verify-reorder-list.ts
 */
import assert from 'node:assert/strict';
import { reorderList } from '../utils/reorderList';

assert.deepEqual(reorderList(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
assert.deepEqual(reorderList(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
assert.deepEqual(reorderList(['a', 'b', 'c'], 1, 1), ['a', 'b', 'c']);
assert.deepEqual(reorderList(['a'], 0, 0), ['a']);
assert.deepEqual(reorderList(['a', 'b'], -1, 1), ['a', 'b']);

console.log('verify-reorder-list: ok');
