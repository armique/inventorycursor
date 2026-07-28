/**
 * Verify daily-backup retention: recent dailies kept, one snapshot per older month kept,
 * everything else pruned — so a year of history stays a few MB in Firebase Storage.
 * Run: npx tsx scripts/verify-backup-retention.ts
 */
import assert from 'node:assert/strict';
import {
  dayFromFileName,
  pickSnapshotsToDelete,
  KEEP_RECENT_DAILY,
} from '../services/backupService';

const name = (day: string) => `snapshot-${day}.json.gz`;

// --- file name parsing ---
assert.equal(dayFromFileName('snapshot-2026-07-28.json.gz'), '2026-07-28');
assert.equal(dayFromFileName('snapshot-2026-07-28.json'), '2026-07-28');
assert.equal(dayFromFileName('something-else.json'), null);
assert.equal(dayFromFileName('snapshot-not-a-date.json'), null);
console.log('OK: only our own snapshot files are recognized (foreign files are never deleted)');

// --- recent dailies are all kept ---
const today = '2026-07-28';
const recent = ['2026-07-28', '2026-07-27', '2026-07-26', '2026-07-20'].map(name);
assert.deepEqual(pickSnapshotsToDelete(recent, today), []);
console.log(`OK: every snapshot inside the last ${KEEP_RECENT_DAILY} days is kept`);

// --- an older month collapses to a single snapshot (the oldest of that month) ---
const older = ['2026-03-02', '2026-03-11', '2026-03-27'].map(name);
const deletedOlder = pickSnapshotsToDelete([...recent, ...older], today);
assert.ok(!deletedOlder.includes(name('2026-03-02')), 'oldest snapshot of the month should survive');
assert.deepEqual(deletedOlder.sort(), [name('2026-03-11'), name('2026-03-27')].sort());
console.log('OK: older months collapse to one kept snapshot (the oldest, pre-corruption one)');

// --- distinct old months each keep their own snapshot ---
const twoMonths = [name('2026-02-05'), name('2026-02-19'), name('2026-04-04')];
const deletedTwo = pickSnapshotsToDelete([...recent, ...twoMonths], today);
assert.deepEqual(deletedTwo, [name('2026-02-19')]);
console.log('OK: each old month independently keeps one snapshot');

// --- beyond the monthly window everything goes ---
const ancient = [name('2023-01-09'), name('2023-06-14')];
const deletedAncient = pickSnapshotsToDelete([...recent, ...ancient], today);
assert.deepEqual(deletedAncient.sort(), ancient.sort());
console.log('OK: snapshots past the monthly retention window are pruned entirely');

// --- a realistic full year stays small ---
const wholeYear: string[] = [];
for (let d = new Date('2025-07-28T00:00:00Z'); d <= new Date('2026-07-28T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
  wholeYear.push(name(d.toISOString().slice(0, 10)));
}
const kept = wholeYear.length - pickSnapshotsToDelete(wholeYear, today).length;
assert.ok(kept <= KEEP_RECENT_DAILY + 14, `a year of daily backups should collapse to ~26 files, got ${kept}`);
console.log(`OK: 366 daily snapshots collapse to ${kept} kept files (~${Math.round(kept * 0.3)} MB at 300 KB each)`);

console.log('\nAll backup retention checks passed.');
