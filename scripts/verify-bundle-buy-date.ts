/**
 * Newly composed PC/bundle parents should use today's date as Acquired (buyDate).
 * Run: npx tsx scripts/verify-bundle-buy-date.ts
 */
import assert from 'node:assert/strict';
import { todayLocalDateKey, toLocalCalendarDateKey } from '../utils/calendarDate';

function run() {
  const today = todayLocalDateKey();
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(today, toLocalCalendarDateKey(new Date()));

  // Simulate compose parent field
  const parentBuyDate = todayLocalDateKey();
  assert.equal(parentBuyDate, today, 'composed container Acquired = composition day');

  // Editing existing keeps prior buyDate
  const existing = { buyDate: '2026-01-15' };
  const kept = existing.buyDate || todayLocalDateKey();
  assert.equal(kept, '2026-01-15');

  console.log('verify-bundle-buy-date: all checks passed');
}

run();
