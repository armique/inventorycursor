/**
 * Verify official-spec merge for product cards.
 * Run: npx tsx scripts/verify-product-card-spec-lookup.ts
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { mergeVerifiedCardSpecs } = require('../lib/productCardSpecLookup.js');

const ctx = {
  name: 'ASUS P5Q Pro',
  category: 'Components',
  subCategory: 'Motherboards',
};

const local = [
  { label: 'Socket', value: 'LGA775' },
  { label: 'Chipset', value: 'P45' },
  { label: 'M.2', value: '2x NVMe' },
  { label: 'Form Factor', value: 'ATX' },
];

const merged = mergeVerifiedCardSpecs(
  local,
  {
    confidence: 'high',
    specs: [
      { label: 'Socket', value: 'LGA 775' },
      { label: 'Chipset', value: 'Intel P45' },
      { label: 'Memory', value: 'DDR2' },
    ],
    rejectClaims: ['M.2', 'NVMe', 'Wi-Fi 6'],
  },
  ctx
);

assert.ok(!merged.some((s) => /m\.?2|nvme/i.test(`${s.label} ${s.value}`)));
assert.ok(merged.some((s) => /socket/i.test(s.label)));
assert.ok(merged.some((s) => /memory|ddr2/i.test(`${s.label} ${s.value}`)));

const low = mergeVerifiedCardSpecs(
  local,
  { confidence: 'low', specs: [{ label: 'Wi-Fi', value: 'Wi-Fi 6E' }], rejectClaims: ['M.2'] },
  ctx
);
assert.ok(!low.some((s) => /m\.?2/i.test(s.label)));
assert.ok(!low.some((s) => /wifi\s*6/i.test(`${s.label} ${s.value}`)));

console.log('verify-product-card-spec-lookup: ok');
