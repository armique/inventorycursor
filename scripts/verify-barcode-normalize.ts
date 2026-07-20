/**
 * Verify barcode digit normalization used by scan lookup.
 * Run: npx tsx scripts/verify-barcode-normalize.ts
 */
import assert from 'node:assert/strict';
import { normalizeBarcodeInput } from '../services/barcodeLookup';

assert.equal(normalizeBarcodeInput('4011200296908'), '4011200296908');
assert.equal(normalizeBarcodeInput('4011 2002 9690 8'), '4011200296908');
assert.equal(normalizeBarcodeInput('EAN: 4011200296908'), '4011200296908');
assert.equal(normalizeBarcodeInput('1234567'), null);
assert.equal(normalizeBarcodeInput('12345678'), '12345678');
assert.equal(normalizeBarcodeInput(''), null);
assert.equal(normalizeBarcodeInput('abc'), null);

console.log('verify-barcode-normalize: ok');
