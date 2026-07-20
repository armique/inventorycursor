/**
 * Accessory toggle helpers (OVP / IO Blende / Rechnung).
 * Run: npx tsx scripts/verify-item-accessory-toggles.ts
 */
import assert from 'node:assert/strict';
import {
  accessoryToggleLabel,
  accessoryTogglePatch,
  accessoryTogglePresent,
  accessoryTogglesForItem,
  isMotherboardItem,
} from '../utils/itemAccessoryToggles.ts';

assert.equal(isMotherboardItem({ category: 'Motherboards', subCategory: '' }), true);
assert.equal(isMotherboardItem({ category: 'Components', subCategory: 'Motherboards' }), true);
assert.equal(isMotherboardItem({ category: 'Components', subCategory: 'RAM' }), false);

assert.deepEqual(accessoryTogglesForItem({ category: 'RAM', subCategory: 'DDR4' }), [
  'ovp',
  'rechnung',
]);
assert.deepEqual(accessoryTogglesForItem({ category: 'Motherboards', subCategory: '' }), [
  'ovp',
  'io',
  'rechnung',
]);

assert.equal(accessoryTogglePresent({ hasOVP: true }, 'ovp'), true);
assert.equal(accessoryTogglePresent({}, 'ovp'), false);
assert.equal(accessoryTogglePresent({ hasReceipt: true }, 'rechnung'), true);
assert.equal(accessoryTogglePresent({ hasIOShield: true }, 'io'), true);

assert.deepEqual(accessoryTogglePatch('ovp', true), { hasOVP: true });
assert.deepEqual(accessoryTogglePatch('ovp', false), { hasOVP: false });
assert.deepEqual(accessoryTogglePatch('io', true), { hasIOShield: true });
assert.deepEqual(accessoryTogglePatch('rechnung', false), { hasReceipt: false });

assert.equal(accessoryToggleLabel('io'), 'IO Blende');
assert.equal(accessoryToggleLabel('rechnung'), 'Rechnung');

console.log('verify-item-accessory-toggles: all checks passed');
