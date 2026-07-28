/**
 * Buy Helper market analysis: calculate percentiles, trends, volatility, velocity
 * from 30-day price history snapshots.
 */

import { type MarketSnapshot, type BuyHelperPriceHistory } from './buyHelperMarketHistory';
import { type MarketPriceSource } from './marketPriceSource';

export type AnalysisSignal = {
  median: number;
  low: number;
  high: number;
  p10: number; // 10th percentile
  p25: number; // 25th percentile
  p75: number; // 75th percentile
  p90: number; // 90th percentile
  stdDev: number; // Standard deviation
  volatility: number; // (high - low) / median * 100
  trend: 'up' | 'down' | 'flat'; // Compare first 10 days vs last 10 days
  velocity: number; // % of listings from last 7 days (0-100)
  count30d: number; // Total listings in 30-day window
  source: MarketPriceSource;
};

export type MarketAnalysis = {
  ebaySold: AnalysisSignal | null;
  ebayLive: AnalysisSignal | null;
  kaLive: AnalysisSignal | null;
};

/**
 * Calculate the percentile value from a sorted array of numbers.
 * p: 0-100 (e.g., 25 for 25th percentile)
 */
export function calculatePercentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  if (p <= 0) return sorted[0];
  if (p >= 100) return sorted[sorted.length - 1];

  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const weight = rank - lower;

  if (lower === upper) return sorted[lower];
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * Calculate standard deviation from an array of numbers.
 */
export function calculateStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, v) => a + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

const CHANNELS = ['ebaySold', 'ebayLive', 'kaLive'] as const;
type Channel = (typeof CHANNELS)[number];

const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

/** Trend for one channel: mean median of the oldest third vs the newest third. */
export function calculateTrend(history: MarketSnapshot[], channel: Channel): 'up' | 'down' | 'flat' {
  const medians = history
    .map((s) => ({ t: s.timestamp, m: s[channel]?.median ?? 0 }))
    .filter((x) => x.m > 0);
  if (medians.length < 4) return 'flat';

  const window = Math.max(1, Math.floor(medians.length / 3));
  const firstAvg = average(medians.slice(0, window).map((x) => x.m));
  const lastAvg = average(medians.slice(-window).map((x) => x.m));
  if (firstAvg <= 0) return 'flat';

  const change = ((lastAvg - firstAvg) / firstAvg) * 100;
  if (change > 2) return 'up';
  if (change < -2) return 'down';
  return 'flat';
}

/**
 * Sales-activity index: mean sold-listing count per snapshot over the last 7 days
 * relative to the full 30-day mean, as a percentage. 100 = same pace as the month,
 * >100 = selling faster lately, <100 = slowing down.
 *
 * Deliberately a ratio, not a share: snapshots are taken on a fixed cadence, so a raw
 * "share of listings seen in the last 7 days" would sit near 23% regardless of demand.
 */
export function calculateVelocity(history: MarketSnapshot[]): number {
  const counts = history
    .map((s) => ({ time: new Date(s.timestamp).getTime(), count: s.ebaySold?.count ?? 0 }))
    .filter((x) => Number.isFinite(x.time));
  if (counts.length < 2) return 0;

  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = counts.filter((x) => x.time >= cutoff);
  if (!recent.length) return 0;

  const overallAvg = average(counts.map((x) => x.count));
  if (overallAvg <= 0) return 0;

  return (average(recent.map((x) => x.count)) / overallAvg) * 100;
}

/**
 * Analyze a single channel (eBay Sold, eBay Live, KA Live) from history.
 */
export function analyzeChannel(history: MarketSnapshot[], channel: Channel): AnalysisSignal | null {
  if (!history.length) return null;

  // Collect all median prices from this channel
  const medians: number[] = [];
  const lows: number[] = [];
  const highs: number[] = [];
  let totalCount = 0;

  for (const snapshot of history) {
    const bucket = snapshot[channel];
    if (bucket && bucket.median != null) {
      medians.push(bucket.median);
      totalCount += bucket.count || 0;
    }
    if (bucket?.low != null) lows.push(bucket.low);
    if (bucket?.high != null) highs.push(bucket.high);
  }

  if (!medians.length) return null;

  medians.sort((a, b) => a - b);
  const median = calculatePercentile(medians, 50);
  const p10 = calculatePercentile(medians, 10);
  const p25 = calculatePercentile(medians, 25);
  const p75 = calculatePercentile(medians, 75);
  const p90 = calculatePercentile(medians, 90);
  const low = lows.length ? Math.min(...lows) : median;
  const high = highs.length ? Math.max(...highs) : median;

  const stdDev = calculateStdDev(medians);
  const volatility = median > 0 ? ((high - low) / median) * 100 : 0;
  const trend = calculateTrend(history, channel);
  const velocity = channel === 'ebaySold' ? calculateVelocity(history) : 0;

  const sourceMap = { ebaySold: 'ebay-sold' as const, ebayLive: 'ebay-live' as const, kaLive: 'ka-live' as const };

  return {
    median,
    low,
    high,
    p10,
    p25,
    p75,
    p90,
    stdDev: Math.round(stdDev * 100) / 100,
    volatility: Math.round(volatility * 100) / 100,
    trend,
    velocity: Math.round(velocity * 100) / 100,
    count30d: totalCount,
    source: sourceMap[channel],
  };
}

/**
 * Analyze full price history and return statistics for all channels.
 */
export function analyzePriceHistory(priceHistory: BuyHelperPriceHistory | null): MarketAnalysis {
  if (!priceHistory || !priceHistory.history.length) {
    return { ebaySold: null, ebayLive: null, kaLive: null };
  }

  return {
    ebaySold: analyzeChannel(priceHistory.history, 'ebaySold'),
    ebayLive: analyzeChannel(priceHistory.history, 'ebayLive'),
    kaLive: analyzeChannel(priceHistory.history, 'kaLive'),
  };
}
