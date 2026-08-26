/**
 * Cloud sync timing helpers.
 * Run: npx tsx scripts/verify-cloud-sync-timing.ts
 */
import assert from 'node:assert/strict';
import {
  FAST_CLOUD_FLUSH_MS,
  WRITE_DEBOUNCE_MS,
  resolveCloudFlushDelay,
  shouldFlushCloudSoon,
} from '../utils/cloudSyncTiming';
import { expenseListLooksUnchanged, inventoryLooksUnchanged } from '../utils/inventoryCloudPush';
import { ItemStatus, type InventoryItem } from '../types';

assert.ok(WRITE_DEBOUNCE_MS <= 1500, 'default cloud debounce should feel under ~1.5s');
assert.ok(FAST_CLOUD_FLUSH_MS < WRITE_DEBOUNCE_MS);

assert.equal(resolveCloudFlushDelay(null), WRITE_DEBOUNCE_MS);
assert.equal(resolveCloudFlushDelay(undefined), WRITE_DEBOUNCE_MS);
assert.equal(resolveCloudFlushDelay(FAST_CLOUD_FLUSH_MS), FAST_CLOUD_FLUSH_MS);
assert.equal(resolveCloudFlushDelay(50_000), WRITE_DEBOUNCE_MS, 'cap at default');
assert.equal(resolveCloudFlushDelay(-10), 0);

assert.equal(shouldFlushCloudSoon({ flushCloud: true }), true);
assert.equal(shouldFlushCloudSoon({ deleteIds: ['a'] }), true);
assert.equal(shouldFlushCloudSoon({ createdContainers: true }), true);
assert.equal(shouldFlushCloudSoon({ statusTransition: true }), true);
assert.equal(shouldFlushCloudSoon({}), false);

const row = (id: string, extra?: Partial<InventoryItem>): InventoryItem => ({
  id,
  name: id,
  buyPrice: 10,
  sellPrice: 20,
  category: 'GPU',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  ...extra,
});
const a = [row('1'), row('2', { saleProceeds: { capturedAt: '', source: 'ebay_seller_hub', netPayoutEur: 12, buyerTotalEur: 20 } })];
assert.equal(inventoryLooksUnchanged(a, a), true);
assert.equal(inventoryLooksUnchanged(a, a.map((i) => ({ ...i }))), true);
assert.equal(inventoryLooksUnchanged(a, [a[0], { ...a[1], sellPrice: 99 }]), false);
assert.equal(inventoryLooksUnchanged(a, [a[0]]), false);

const exp = { id: 'e1', description: 'Ads', amount: 12, date: '2026-01-01', category: 'Fees' };
assert.equal(expenseListLooksUnchanged([exp], [{ ...exp }]), true);
assert.equal(expenseListLooksUnchanged([exp], [{ ...exp, amount: 13 }]), false);

console.log('verify-cloud-sync-timing: all checks passed');
