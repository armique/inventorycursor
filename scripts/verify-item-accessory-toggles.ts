/**
 * Accessory toggle helpers (OVP / IO Blende tri-state).
 * Run: npx tsx scripts/verify-item-accessory-toggles.ts
 */
import assert from 'node:assert/strict';
import {
  accessoryToggleLabel,
  accessoryTogglePatch,
  accessoryToggleState,
  accessoryTogglesForItem,
  cycleAccessoryTogglePatch,
  isIOShieldRelevant,
  isMotherboardItem,
  listingAccessoriesReady,
  resolveIoShieldTriState,
} from '../utils/itemAccessoryToggles.ts';

assert.equal(isMotherboardItem({ category: 'Motherboards', subCategory: '' }), true);
assert.equal(isMotherboardItem({ category: 'Components', subCategory: 'Motherboards' }), true);
assert.equal(isMotherboardItem({ category: 'Components', subCategory: 'RAM' }), false);

assert.deepEqual(accessoryTogglesForItem({ category: 'RAM', subCategory: 'DDR4' }), ['ovp']);
assert.deepEqual(accessoryTogglesForItem({ category: 'Motherboards', subCategory: '' }), [
  'ovp',
  'io',
]);
assert.deepEqual(
  accessoryTogglesForItem(
    { category: 'Bundle', subCategory: '', isBundle: true, name: 'PC parts' },
    [{ category: 'Components', subCategory: 'Motherboards' }]
  ),
  ['ovp', 'io']
);
assert.equal(
  isIOShieldRelevant({ category: 'Components', subCategory: 'Graphics Cards' }),
  false
);

assert.equal(accessoryToggleState({}, 'ovp'), 'unspecified');
assert.equal(accessoryToggleState({ hasOVP: true }, 'ovp'), 'present');
assert.equal(accessoryToggleState({ hasOVP: false }, 'ovp'), 'missing');

assert.deepEqual(accessoryTogglePatch('ovp', true), { hasOVP: true });
assert.deepEqual(accessoryTogglePatch('ovp', false), { hasOVP: false });
assert.deepEqual(cycleAccessoryTogglePatch({}, 'ovp'), { hasOVP: true });
assert.deepEqual(cycleAccessoryTogglePatch({ hasOVP: true }, 'ovp'), { hasOVP: false });
assert.deepEqual(cycleAccessoryTogglePatch({ hasOVP: false }, 'ovp'), { hasOVP: undefined });

assert.equal(listingAccessoriesReady({ category: 'RAM', subCategory: 'DDR4' }).ok, false);
assert.equal(
  listingAccessoriesReady({ category: 'RAM', subCategory: 'DDR4', hasOVP: true }).ok,
  true
);
assert.equal(
  listingAccessoriesReady({ category: 'Motherboards', subCategory: '', hasOVP: true }).ok,
  false
);
assert.equal(
  listingAccessoriesReady({
    category: 'Motherboards',
    subCategory: '',
    hasOVP: true,
    hasIOShield: false,
  }).ok,
  true
);

assert.equal(accessoryToggleLabel('io'), 'IO Blende');

assert.equal(
  resolveIoShieldTriState(
    { category: 'Bundle', subCategory: '', isBundle: true, name: 'Kit' },
    [{ category: 'Components', subCategory: 'Motherboards', name: 'Z97', hasIOShield: false }]
  ),
  'missing'
);
assert.equal(
  listingAccessoriesReady(
    { category: 'Bundle', subCategory: '', isBundle: true, name: 'Kit', hasOVP: true },
    [{ category: 'Components', subCategory: 'Motherboards', name: 'Z97', hasIOShield: true }]
  ).ok,
  true
);

console.log('verify-item-accessory-toggles: all checks passed');
