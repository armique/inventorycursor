/**
 * Component part tone mapping for inventory accents.
 * Run: npx tsx scripts/verify-component-part-tone.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus } from '../types';
import { resolveComponentPartKind, resolveComponentPartTone } from '../utils/componentPartTone';

const base = {
  id: '1',
  name: 'x',
  buyPrice: 1,
  buyDate: '2026-01-01',
  category: 'Components',
  status: ItemStatus.IN_STOCK,
  comment1: '',
  comment2: '',
};

assert.equal(resolveComponentPartKind({ ...base, subCategory: 'Processors' }), 'cpu');
assert.equal(resolveComponentPartKind({ ...base, subCategory: 'Motherboards' }), 'motherboard');
assert.equal(resolveComponentPartKind({ ...base, subCategory: 'Graphics Cards' }), 'gpu');
assert.equal(resolveComponentPartKind({ ...base, subCategory: 'GPU' }), 'gpu');
assert.equal(resolveComponentPartKind({ ...base, subCategory: 'RAM' }), 'ram');
assert.equal(resolveComponentPartKind({ ...base, subCategory: 'Storage (SSD/HDD)' }), 'storage');
assert.equal(resolveComponentPartKind({ ...base, subCategory: 'Power Supplies' }), 'psu');
assert.equal(resolveComponentPartKind({ ...base, subCategory: 'Cases' }), 'case');
assert.equal(resolveComponentPartKind({ ...base, subCategory: 'Cooling' }), 'cooling');
assert.equal(resolveComponentPartKind({ ...base, isPC: true, subCategory: 'Processors' }), null);
assert.ok(resolveComponentPartTone({ ...base, subCategory: 'Processors' })?.accentHex);

console.log('verify-component-part-tone: ok');
