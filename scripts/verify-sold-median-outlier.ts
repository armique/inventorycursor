/**
 * Verify filterSoldMedianOutliers() + summarizeComponentTotals() — the two
 * pieces that together fix Problem A (whole-PC/bundle sales inflating a
 * single-part sold median) and Problem B (ambiguous "OVP" box-only lots
 * dragging it down), while leaving genuinely cheap real cards alone.
 * Run: npx tsx scripts/verify-sold-median-outlier.ts
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Dealwatch = require('../dealwatch-runtime/server.js');
const { filterSoldMedianOutliers, summarizeComponentTotals, loadClassifierConfig, classifyLotType, normalizeListingText } = Dealwatch;

function item(sourceText: string, total: number) {
  return {
    id: `sold|${Math.random()}`,
    title: sourceText,
    total,
    sourceText,
    lotType: classifyLotType(normalizeListingText(sourceText)),
  };
}

const config = loadClassifierConfig().soldMedianOutlier;
console.log('\n=== classifier-config.json thresholds in use ===');
console.log(config);

// Ten normal RTX 4060 sold totals (component lots), real median 56.5.
const normalSales = [45, 48, 50, 52, 55, 58, 60, 62, 65, 68].map((price) =>
  item(`RTX 4060 8GB Grafikkarte gebraucht ${price}`, price),
);

// Bare "OVP" mention, no "nur"/"ohne" wording — classifyLotType alone can't tell box-only
// from card-with-box (isPackagingWithoutCard needs explicit "nur/ohne" phrasing, see
// dealwatch-runtime/server.js's isPackagingWithoutCard). Priced far below the pack is the only signal.
const probableBoxOnly = item('RTX 4060 OVP', 8);

// A genuinely cheap real card — no ambiguous wording — must NOT be excluded.
const genuinelyCheapRealCard = item('RTX 4060 8GB Grafikkarte defektes Lüfterlager sonst ok', 22);

// Problem A, exactly as originally described: expensive whole-PC lots that happen to mention
// the GPU model. Must never move the single-card median, even though they're real,
// legitimately-priced sales (not outlier/junk lots — just the wrong item type).
// Five of them (not one) so the contamination is unambiguous — a single high outlier can
// coincidentally land on the same median index and mask the bug rather than prove the fix.
const expensiveWholePcs = [800, 820, 840, 860, 880].map((price) =>
  item(`Gaming PC RTX 4060 Ryzen 5600 32GB RAM 1TB SSD komplett System ${price}`, price),
);

const items = [...normalSales, probableBoxOnly, genuinelyCheapRealCard, ...expensiveWholePcs];
const { clean, flagged } = filterSoldMedianOutliers(items, config);

console.log('\n=== filterSoldMedianOutliers — input ===');
for (const i of items) console.log(`  total=${String(i.total).padStart(4)}  lotType=${i.lotType.padEnd(12)} "${i.title}"`);

console.log('\n=== filterSoldMedianOutliers — flagged (excluded from median) ===');
for (const i of flagged) console.log(`  total=${i.total}  "${i.title}"`);

console.log('\n=== filterSoldMedianOutliers — clean (still returned, nothing hidden) ===');
for (const i of clean) console.log(`  total=${i.total}  lotType=${i.lotType}  "${i.title}"`);

const naiveMedianOverAllClean = (() => {
  const totals = clean.map((i: { total: number }) => i.total).sort((a: number, b: number) => a - b);
  return totals[Math.floor((totals.length - 1) / 2)];
})();
const componentSummary = summarizeComponentTotals(clean);

console.log(`\nnaive median over ALL clean items (old behavior, includes whole_pc): ${naiveMedianOverAllClean}`);
console.log(`summarizeComponentTotals median (what searchSoldListings now actually returns): ${componentSummary.median}`);
console.log(`  component sample size: ${componentSummary.count}, low=${componentSummary.low}, high=${componentSummary.high}`);

assert.ok(flagged.some((i: { title: string }) => i.title === 'RTX 4060 OVP'), 'bare-OVP low-price lot must be flagged');
assert.ok(!clean.some((i: { title: string }) => i.title === 'RTX 4060 OVP'), 'bare-OVP low-price lot must not be in clean set');
assert.ok(clean.some((i: { title: string }) => i.title.includes('defektes Lüfterlager')), 'genuinely cheap real card must stay');
assert.equal(clean.filter((i: { lotType: string }) => i.lotType === 'whole_pc').length, 5, 'all 5 expensive whole_pc lots must stay visible in items, not silently dropped');
assert.equal(clean.length, items.length - 1, 'exactly one lot (the bare-OVP one) should be excluded from `items`');

// The actual Problem A assertion: the 5 expensive whole-PC sales must not move the component
// median at all, even though a naive median-over-everything clearly shifts toward them.
assert.equal(componentSummary.count, 11, 'component sample must be the 10 normal sales + 1 genuinely cheap real card');
assert.ok(componentSummary.median >= 50 && componentSummary.median <= 60, `component median must stay near the real cards' range, got ${componentSummary.median}`);
assert.ok(naiveMedianOverAllClean - componentSummary.median >= 3, `naive median must be pulled meaningfully higher by the whole-PC lots (naive=${naiveMedianOverAllClean}, component=${componentSummary.median})`);

console.log('\nverify-sold-median-outlier: ok');
