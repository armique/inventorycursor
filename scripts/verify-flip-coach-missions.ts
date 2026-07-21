/**
 * Verify Flip Coach daily mission helpers.
 * Run: npx tsx scripts/verify-flip-coach-missions.ts
 */
import assert from 'node:assert/strict';
import {
  channelLabel,
  computeListStreak,
  getMissionProgress,
  localDayKey,
  type MissionLogEntry,
} from '../utils/flipCoachMissions';

assert.equal(channelLabel('kleinanzeigen.de'), 'Kleinanzeigen');
assert.equal(channelLabel('ebay.de'), 'eBay');

const today = localDayKey();
const log: MissionLogEntry[] = [
  { itemId: 'a', action: 'listed', day: today, at: new Date().toISOString() },
  { itemId: 'b', action: 'listed', day: today, at: new Date().toISOString() },
  { itemId: 'c', action: 'skipped', day: today, at: new Date().toISOString() },
];

const progress = getMissionProgress(log, 3);
assert.equal(progress.completedToday, 2);
assert.equal(progress.targetToday, 3);
assert.ok(progress.streakDays >= 1);

assert.equal(computeListStreak(log), 1);

console.log('verify-flip-coach-missions: ok');
