/**
 * Listing AI accessory hints (OVP / IO).
 * IO is only included for motherboard-relevant items.
 */
import assert from 'node:assert/strict';
import {
  ensureIoBlendeInListingText,
  resolveListingAccessoryHints,
} from '../services/marketplaceListingAI.ts';

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
  resolveListingAccessoryHints({
    category: 'RAM',
    subCategory: 'DDR4',
    hasReceipt: true,
  }),
  {
    ovp: 'UNSPECIFIED',
    io: null,
    includeIOShield: false,
    hasOVP: false,
    hasIOShield: false,
    hasReceipt: true,
  }
);

// Bundle: IO from motherboard child when parent flag unset
assert.deepEqual(
  resolveListingAccessoryHints(
    { category: 'Bundle', subCategory: '', isBundle: true, name: 'Aufrüstkit' },
    {
      children: [
        { category: 'Components', subCategory: 'Motherboards', name: 'ASUS Z97', hasIOShield: true },
      ],
    }
  ),
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
    { category: 'Bundle', subCategory: '', isBundle: true, name: 'Aufrüstkit', hasIOShield: false },
    {
      children: [
        { category: 'Components', subCategory: 'Motherboards', name: 'ASUS Z97', hasIOShield: true },
      ],
    }
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

const withIo = ensureIoBlendeInListingText(
  'Title\n\n📦 Lieferumfang:\n• Mainboard\n\n✅ Zustand:\nGebraucht',
  'YES'
);
assert.match(withIo, /IO-Blende inklusive/);

const withOhne = ensureIoBlendeInListingText(
  'Title\n\n📦 Lieferumfang:\n• Mainboard\n\n✅ Zustand:\nGebraucht',
  'NO'
);
assert.match(withOhne, /Ohne IO-Blende/);

const already = ensureIoBlendeInListingText(
  'Title\n\n📦 Lieferumfang:\n• IO-Blende inklusive\n\n✅ Zustand:\nGebraucht',
  'YES'
);
assert.equal((already.match(/IO-Blende inklusive/g) || []).length, 1);

console.log('verify-listing-accessory-hints: ok');
