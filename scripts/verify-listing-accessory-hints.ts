/**
 * Listing AI accessory hints (OVP / IO / Rechnung) + Gebrauchsspuren notice.
 */
import assert from 'node:assert/strict';
import { resolveListingAccessoryHints } from '../services/marketplaceListingAI.ts';

assert.deepEqual(resolveListingAccessoryHints({}), {
  hasOVP: false,
  hasIOShield: false,
  hasReceipt: false,
});

assert.deepEqual(
  resolveListingAccessoryHints({ hasOVP: true, hasReceipt: true }),
  { hasOVP: true, hasIOShield: false, hasReceipt: true }
);

assert.deepEqual(
  resolveListingAccessoryHints({ hasOVP: false }, { hasOVP: true, hasIOShield: true }),
  { hasOVP: true, hasIOShield: true, hasReceipt: false }
);

assert.deepEqual(
  resolveListingAccessoryHints({ hasReceipt: true }, { hasReceipt: false }),
  { hasOVP: false, hasIOShield: false, hasReceipt: true }
);

console.log('verify-listing-accessory-hints: ok');
