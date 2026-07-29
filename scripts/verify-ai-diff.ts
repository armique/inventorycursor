/**
 * Verify AI audit diffing: field allow-list, empty-value handling, action classification,
 * and the read/write field-path helpers that Revert relies on.
 * Run: npx tsx scripts/verify-ai-diff.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import {
  classifyAiAction,
  diffInventoryItems,
  formatDiffValue,
  formatFieldLabel,
  readItemField,
  writeItemField,
} from '../utils/aiDiff';

function item(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 'i1',
    name: 'RAM 16GB DDR4',
    buyPrice: 20,
    buyDate: '2026-07-01',
    category: 'RAM',
    status: ItemStatus.IN_STOCK,
    comment1: '',
    comment2: '',
    ...overrides,
  };
}

// --- creation: only non-empty fields are recorded ---
const created = diffInventoryItems(undefined, item());
const createdFields = created.map((d) => d.field).sort();
assert.deepEqual(createdFields, ['buyDate', 'buyPrice', 'category', 'name', 'status']);
assert.equal(classifyAiAction(undefined, item(), created), 'item_created');

// --- single field change ---
const oneField = diffInventoryItems(item(), item({ buyPrice: 25 }));
assert.deepEqual(oneField, [{ field: 'buyPrice', oldValue: 20, newValue: 25 }]);
assert.equal(classifyAiAction(item(), item({ buyPrice: 25 }), oneField), 'field_changed');

// --- several fields read as a general update ---
const many = diffInventoryItems(item(), item({ buyPrice: 25, vendor: 'Felix' }));
assert.equal(many.length, 2);
assert.equal(classifyAiAction(item(), item({ buyPrice: 25, vendor: 'Felix' }), many), 'item_updated');

// --- no-op update produces no diff (undefined vs '' must not count) ---
assert.deepEqual(diffInventoryItems(item(), item()), []);
assert.deepEqual(diffInventoryItems(item({ vendor: undefined }), item({ vendor: '' })), []);

// --- untracked fields are ignored (images, sync bookkeeping) ---
assert.deepEqual(
  diffInventoryItems(item(), item({ imageUrl: 'https://x/y.jpg', liveEbayListPrice: 40 })),
  []
);

// --- sale detection ---
const sold = item({ status: ItemStatus.SOLD, sellPrice: 45, sellDate: '2026-07-20' });
const soldDiff = diffInventoryItems(item(), sold);
assert.equal(classifyAiAction(item(), sold, soldDiff), 'marked_sold');
assert.ok(soldDiff.some((d) => d.field === 'status' && d.newValue === ItemStatus.SOLD));

// --- buyer-only changes ---
const withBuyer = item({ customer: { name: 'Felix Matthes', address: 'Berlin' } });
const buyerDiff = diffInventoryItems(item(), withBuyer);
assert.deepEqual(buyerDiff.map((d) => d.field).sort(), ['customer.address', 'customer.name']);
assert.equal(classifyAiAction(item(), withBuyer, buyerDiff), 'buyer_info_filled');

// --- specs are diffed per key ---
const specsBefore = item({ specs: { Capacity: '16GB', Speed: '2400' } });
const specsAfter = item({ specs: { Capacity: '16GB', Speed: '3200', Kit: '2x8' } });
const specsDiff = diffInventoryItems(specsBefore, specsAfter);
assert.deepEqual(specsDiff.map((d) => d.field).sort(), ['specs.Kit', 'specs.Speed']);

// --- field path read/write round-trip (used by Revert) ---
assert.equal(readItemField(withBuyer, 'customer.name'), 'Felix Matthes');
assert.equal(readItemField(specsAfter, 'specs.Speed'), '3200');
assert.equal(readItemField(item(), 'vendor'), null);

const revertedSpeed = writeItemField(specsAfter, 'specs.Speed', '2400');
assert.equal(revertedSpeed.specs?.Speed, '2400');
assert.equal(specsAfter.specs?.Speed, '3200', 'writeItemField must not mutate the input');

const clearedBuyer = writeItemField(withBuyer, 'customer.name', null);
assert.equal(clearedBuyer.customer?.name, undefined);
assert.equal(clearedBuyer.customer?.address, 'Berlin');

const clearedAll = writeItemField(writeItemField(withBuyer, 'customer.name', null), 'customer.address', null);
assert.equal(clearedAll.customer, undefined, 'customer drops entirely once every field is empty');

const clearedVendor = writeItemField(item({ vendor: 'Felix' }), 'vendor', null);
assert.equal('vendor' in clearedVendor, false);

// Writing back an old value must make the diff disappear again.
const roundTrip = writeItemField(item({ buyPrice: 25 }), 'buyPrice', 20);
assert.deepEqual(diffInventoryItems(item(), roundTrip), []);

// --- display helpers ---
assert.equal(formatFieldLabel('buyPrice'), 'Buy price');
assert.equal(formatFieldLabel('specs.Speed'), 'Spec: Speed');
assert.equal(formatDiffValue(null), '—');
assert.equal(formatDiffValue(''), '—');
assert.equal(formatDiffValue(true), 'yes');
assert.equal(formatDiffValue(25), '25');

console.log('verify-ai-diff: ok');
