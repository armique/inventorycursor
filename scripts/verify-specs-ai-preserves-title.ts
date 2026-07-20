/**
 * Specs parse must not rename items; only explicit AI-title opt-in may.
 */
import assert from 'node:assert/strict';
import { pickSpecsAiNameVendorUpdates } from '../utils/applySpecsAiResult.ts';

const result = {
  standardizedName: 'SK Hynix 4GB DDR3 UDIMM HMT351U6EFR8C',
  vendor: 'SK Hynix',
};

const fromSpecsParse = pickSpecsAiNameVendorUpdates(result);
assert.equal(fromSpecsParse.name, undefined, 'Parse specs must not change item title');
assert.equal(fromSpecsParse.vendor, 'SK Hynix');

const fromTitleButton = pickSpecsAiNameVendorUpdates(result, { applyStandardizedName: true });
assert.equal(fromTitleButton.name, result.standardizedName);
assert.equal(fromTitleButton.vendor, 'SK Hynix');

const empty = pickSpecsAiNameVendorUpdates({}, { applyStandardizedName: true });
assert.deepEqual(empty, {});

console.log('verify-specs-ai-preserves-title: all checks passed');
