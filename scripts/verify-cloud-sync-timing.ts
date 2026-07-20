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

console.log('verify-cloud-sync-timing: all checks passed');
