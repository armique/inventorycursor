/**
 * Verifies Buy Helper market-history math: percentiles, stddev, trend, velocity,
 * 30-day pruning, and end-to-end channel analysis.
 *
 * Run: npx tsx scripts/verify-buy-helper-market-history.ts
 */

import {
  analyzeChannel,
  calculatePercentile,
  calculateStdDev,
  calculateTrend,
  calculateVelocity,
} from '../services/buyHelperMarketAnalysis';
import { prunePriceHistory, type MarketSnapshot } from '../services/buyHelperMarketHistory';

let failures = 0;

function eq(name: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

function assert(name: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${detail}`);
}

const sorted = [10, 20, 30, 40, 50];
eq('percentile p50', calculatePercentile(sorted, 50), 30);
eq('percentile p25', calculatePercentile(sorted, 25), 20);
eq('percentile p0 clamps to low', calculatePercentile(sorted, 0), 10);
eq('percentile p100 clamps to high', calculatePercentile(sorted, 100), 50);
eq('percentile of empty set', calculatePercentile([], 50), 0);

eq('stdDev of known set', calculateStdDev([2, 4, 4, 4, 5, 5, 7, 9]), 2);
eq('stdDev of single value', calculateStdDev([5]), 0);

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const snap = (day: number, median: number, count = 10): MarketSnapshot => ({
  timestamp: daysAgo(day),
  ebaySold: { median, low: median - 5, high: median + 5, count, items: [] },
  ebayLive: null,
  kaLive: null,
});

const rising = [snap(20, 100), snap(16, 105), snap(12, 110), snap(8, 115), snap(4, 130), snap(1, 140)];
const falling = [snap(20, 140), snap(16, 130), snap(12, 115), snap(8, 110), snap(4, 105), snap(1, 100)];

eq('trend detects rise', calculateTrend(rising, 'ebaySold'), 'up');
eq('trend detects fall', calculateTrend(falling, 'ebaySold'), 'down');
eq('trend flat on thin sample', calculateTrend([snap(2, 100)], 'ebaySold'), 'flat');
eq('trend reads the channel it was asked for', calculateTrend(rising, 'kaLive'), 'flat');

const accelerating = calculateVelocity([snap(20, 100, 10), snap(15, 100, 10), snap(3, 100, 20), snap(1, 100, 20)]);
assert('velocity >100 when recent sales outpace the month', accelerating > 100, `got ${accelerating}`);

const steady = calculateVelocity([snap(20, 100, 10), snap(15, 100, 10), snap(3, 100, 10), snap(1, 100, 10)]);
assert('velocity ~100 when pace is unchanged', Math.abs(steady - 100) < 0.001, `got ${steady}`);

const pruned = prunePriceHistory([snap(45, 100), snap(10, 100), snap(2, 100)]);
eq('prune drops snapshots older than 30 days', pruned.length, 2);
assert(
  'prune returns oldest first',
  new Date(pruned[0].timestamp).getTime() < new Date(pruned[1].timestamp).getTime(),
  `${pruned[0].timestamp} < ${pruned[1].timestamp}`,
);

const signal = analyzeChannel(rising, 'ebaySold');
eq('signal sums listing counts', signal?.count30d, 60);
eq('signal carries trend', signal?.trend, 'up');
eq('signal source label', signal?.source, 'ebay-sold');
eq('channel with no data yields null', analyzeChannel(rising, 'kaLive'), null);
eq('empty history yields null', analyzeChannel([], 'ebaySold'), null);

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
