/**
 * Verify Firestore free-quota parsers & meter math.
 */
import assert from 'node:assert/strict';
import {
  FIRESTORE_FREE,
  STORAGE_FREE,
  buildQuotaSnapshot,
  formatBytes,
  formatOps,
  makeMeter,
  parseMonitoringQuotaResponse,
  parseMonitoringTimeSeries,
  pacificDayKey,
} from '../utils/firestoreFreeQuota';
import { collectStorageUrlsFromItems } from '../services/firestoreQuotaService';

assert.equal(FIRESTORE_FREE.storedBytes, 1 * 1024 * 1024 * 1024);
assert.equal(FIRESTORE_FREE.readsPerDay, 50_000);
assert.equal(STORAGE_FREE.storedBytes, 5 * 1024 * 1024 * 1024);

const m = makeMeter(250 * 1024 * 1024, FIRESTORE_FREE.storedBytes);
assert.ok(m.remaining > 700 * 1024 * 1024);
assert.ok(m.pctFree > 70);
assert.ok(m.pctUsed < 30);

assert.equal(
  parseMonitoringTimeSeries({
    timeSeries: [{ points: [{ value: { int64Value: '1200' } }, { value: { int64Value: '300' } }] }],
  }),
  1500
);

const parsed = parseMonitoringQuotaResponse({
  ok: true,
  projectId: 'demo',
  reads: 100,
  writes: 20,
  deletes: 5,
});
assert.equal(parsed.ok, true);
assert.equal(parsed.reads, 100);

const snap = buildQuotaSnapshot({
  projectId: 'inventorycursor-e9000',
  firestoreStoredBytes: 12_000_000,
  firestoreSyncDocs: 8,
  storageStoredBytes: 80_000_000,
  storageFiles: 40,
  localReads: 50,
  localWrites: 10,
  localDeletes: 1,
  monitoring: { ok: true, reads: 1200, writes: 80, deletes: 3 },
});

assert.equal(snap.source, 'mixed');
assert.equal(snap.firestore.readsToday.used, 1200);
assert.equal(snap.firestore.writesToday.used, 80);
assert.ok(snap.firestore.stored.remaining > 0);
assert.ok(snap.pacificDay === pacificDayKey() || /^\d{4}-\d{2}-\d{2}$/.test(snap.pacificDay));
assert.ok(formatBytes(1536).includes('KB'));
assert.equal(formatOps(1500), '1.5k');

const urls = collectStorageUrlsFromItems([
  {
    imageUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/items%2Fa%2Fb%2Fc.jpg?alt=media',
    imageUrls: [
      'https://firebasestorage.googleapis.com/v0/b/x/o/items%2Fa%2Fb%2Fc.jpg?alt=media',
      'https://firebasestorage.googleapis.com/v0/b/x/o/items%2Fa%2Fb%2Fd.jpg?alt=media',
      'data:image/png;base64,xxx',
    ],
  },
]);
assert.equal(urls.length, 2);

console.log('verify-firestore-free-quota: ok');
