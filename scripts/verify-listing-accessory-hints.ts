/**
 * Listing AI accessory hints (OVP / IO / Rechnung).
 * IO is only included for motherboard category items.
 */
import assert from 'node:assert/strict';
import { resolveListingAccessoryHints } from '../services/marketplaceListingAI.ts';

assert.deepEqual(resolveListingAccessoryHints({ category: 'GPUs', subCategory: '' }), {
  hasOVP: false,
  hasIOShield: false,
  hasReceipt: false,
  includeIOShield: false,
});

assert.deepEqual(
  resolveListingAccessoryHints({
    category: 'GPUs',
    subCategory: '',
    hasOVP: true,
    hasReceipt: true,
    hasIOShield: true,
  }),
  { hasOVP: true, hasIOShield: false, hasReceipt: true, includeIOShield: false }
);

assert.deepEqual(
  resolveListingAccessoryHints(
    { category: 'GPUs', subCategory: '', hasOVP: false },
    { hasOVP: true, hasIOShield: true }
  ),
  { hasOVP: true, hasIOShield: false, hasReceipt: false, includeIOShield: false }
);

assert.deepEqual(
  resolveListingAccessoryHints({
    category: 'Motherboards',
    subCategory: '',
    hasIOShield: true,
  }),
  { hasOVP: false, hasIOShield: true, hasReceipt: false, includeIOShield: true }
);

assert.deepEqual(
  resolveListingAccessoryHints(
    { category: 'Components', subCategory: 'Motherboards' },
    { hasIOShield: false }
  ),
  { hasOVP: false, hasIOShield: false, hasReceipt: false, includeIOShield: true }
);

assert.deepEqual(
  resolveListingAccessoryHints({ category: 'RAM', subCategory: 'DDR4', hasReceipt: true }),
  { hasOVP: false, hasIOShield: false, hasReceipt: true, includeIOShield: false }
);

console.log('verify-listing-accessory-hints: ok');
