/**
 * Verify the background-read throttle used to stop re-scanning whole Firestore collections
 * (product card counts, Buy Helper price histories) on every page visit.
 * Run: npx tsx scripts/verify-cloud-fetch-throttle.ts
 */
import assert from 'node:assert/strict';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

const { shouldSkipCloudRefetch, markCloudRefetchDone } = await import('../utils/cloudFetchThrottle');

// Never synced -> don't skip (must fetch at least once).
assert.equal(shouldSkipCloudRefetch('demo', 5 * 60 * 1000), false);
console.log('OK: never-synced id is not throttled');

markCloudRefetchDone('demo');
assert.equal(shouldSkipCloudRefetch('demo', 5 * 60 * 1000), true);
console.log('OK: just-synced id is throttled within the window');

assert.equal(shouldSkipCloudRefetch('demo', 0), false);
console.log('OK: a zero-length window never throttles');

assert.equal(shouldSkipCloudRefetch('other-key', 5 * 60 * 1000), false);
console.log('OK: throttle keys are independent per id');

console.log('\nAll cloud-fetch throttle checks passed.');
