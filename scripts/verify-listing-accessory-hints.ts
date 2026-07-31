/**
 * Listing AI accessory hints (OVP / IO).
 * IO is only included for motherboard-relevant items.
 */
import assert from 'node:assert/strict';
import { resolveListingAccessoryHints } from '../services/marketplaceListingAI.ts';

assert.deepEqual(resolveListingAccessoryHints({ category: 'GPUs', subCategory: '' }), {
  ovp: 'UNSPECIFIED',
  io: null,
  includeIOShield: false,
  hasOVP: false,
  hasIOShield: false,
  hasReceipt: false,
});

assert.deepEqual(
  resolveListingAccessoryHints({
    category: 'GPUs',
    subCategory: '',
    hasOVP: true,
    hasReceipt: true,
    hasIOShield: true,
  }),
  {
    ovp: 'YES',
    io: null,
    includeIOShield: false,
    hasOVP: true,
    hasIOShield: false,
    hasReceipt: true,
  }
);

assert.deepEqual(
  resolveListingAccessoryHints(
    { category: 'GPUs', subCategory: '', hasOVP: false },
    { hasOVP: true, hasIOShield: true }
  ),
  {
    ovp: 'YES',
    io: null,
    includeIOShield: false,
    hasOVP: true,
    hasIOShield: false,
    hasReceipt: false,
  }
);

assert.deepEqual(
  resolveListingAccessoryHints({
    category: 'Motherboards',
    subCategory: '',
    hasIOShield: true,
  }),
  {
    ovp: 'UNSPECIFIED',
    io: 'YES',
    includeIOShield: true,
    hasOVP: false,
    hasIOShield: true,
    hasReceipt: false,
  }
);

assert.deepEqual(
  resolveListingAccessoryHints(
    { category: 'Components', subCategory: 'Motherboards' },
    { hasIOShield: false }
  ),
  {
    ovp: 'UNSPECIFIED',
    io: 'NO',
    includeIOShield: true,
    hasOVP: false,
    hasIOShield: false,
    hasReceipt: false,
  }
);

assert.deepEqual(
  resolveListingAccessoryHints({ category: 'RAM', subCategory: 'DDR4', hasReceipt: true }),
  {
    ovp: 'UNSPECIFIED',
    io: null,
    includeIOShield: false,
    hasOVP: false,
    hasIOShield: false,
    hasReceipt: true,
  }
);

console.log('verify-listing-accessory-hints: ok');
