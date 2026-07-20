/**
 * Sync badge labels — pending vs uploading vs synced.
 * Run: npx tsx scripts/verify-cloud-sync-status.ts
 */
import assert from 'node:assert/strict';
import {
  SYNC_MSG_PENDING,
  SYNC_MSG_UPLOADING,
  SYNC_MSG_SYNCED,
  cloudSyncBadgeLabel,
  cloudSyncBadgeTitle,
  formatSyncedClock,
} from '../utils/cloudSyncStatus';

assert.equal(cloudSyncBadgeLabel({ status: 'pending' }), SYNC_MSG_PENDING);
assert.equal(cloudSyncBadgeLabel({ status: 'syncing' }), SYNC_MSG_UPLOADING);
assert.equal(cloudSyncBadgeLabel({ status: 'success', message: 'Live' }), SYNC_MSG_SYNCED);
assert.equal(cloudSyncBadgeLabel({ status: 'success', message: 'Saved' }), SYNC_MSG_SYNCED);
assert.equal(cloudSyncBadgeLabel({ status: 'idle' }), '');

const at = new Date('2026-07-20T12:34:00');
assert.equal(formatSyncedClock(at).startsWith('Synced'), true);
assert.ok((cloudSyncBadgeTitle({ status: 'pending' }) || '').includes('this device'));
assert.ok((cloudSyncBadgeTitle({ status: 'syncing' }) || '').toLowerCase().includes('upload'));

// Must not claim synced while still pending
assert.notEqual(cloudSyncBadgeLabel({ status: 'pending' }), SYNC_MSG_SYNCED);
assert.notEqual(cloudSyncBadgeLabel({ status: 'syncing' }), SYNC_MSG_SYNCED);

console.log('verify-cloud-sync-status: all checks passed');
