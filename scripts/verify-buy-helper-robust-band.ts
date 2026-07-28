/**
 * Verifies the fix for Buy Helper showing absurd low/high bands (e.g. an RTX 4060
 * quoted "€22–€2164"): summarizeComponentTotals() now Tukey-fences the band instead of
 * taking raw min/max, and buildBuyHelperQuoteQuery() always keeps the parts-defekt /
 * fake-replica smart filters on (a normal saved search defaults them off because a human
 * curates results with pills; the buy-helper bridge runs unattended).
 *
 * Run: npx tsx scripts/verify-buy-helper-robust-band.ts
 */

import Module from 'node:module';
const require = Module.createRequire(import.meta.url);
const market = require('../market/server.js');
const { robustBand, summarizeComponentTotals, buildBuyHelperQuoteQuery } = market;

let failures = 0;

function eq(name: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

// A realistic RTX 4060 sample: sane cluster around €260-330, one mislabeled "defekt"
// single dragging low to €22, one misclassified bundle dragging high to €2164.
const rtx4060Totals = [22, 261, 265, 270, 275, 280, 285, 290, 295, 300, 305, 310, 320, 330, 2164].sort((a, b) => a - b);
const band = robustBand(rtx4060Totals);
console.log(`RTX 4060 sample band: €${band.low}–€${band.high} (raw min/max was €22–€2164)`);
if (!(band.low! > 22 && band.low! <= 261)) { failures++; console.log('FAIL low should exclude the €22 outlier'); }
else console.log('PASS low excludes the €22 outlier');
if (!(band.high! < 2164 && band.high! >= 330)) { failures++; console.log('FAIL high should exclude the €2164 outlier'); }
else console.log('PASS high excludes the €2164 outlier');

// Fewer than 4 samples: IQR is meaningless, must pass raw min/max through unchanged
// (this is the exact case scripts/verify-buy-helper-quote-bridge.ts already asserts on).
eq('small sample (n=3) keeps raw min/max', robustBand([50, 55, 60]), { low: 50, high: 60 });
eq('empty sample', robustBand([]), { low: null, high: null });

// summarizeComponentTotals end-to-end with lotType filtering still intact.
const items = rtx4060Totals.map((total) => ({ total, lotType: 'component' }));
items.push({ total: 500, lotType: 'whole_pc' } as any); // must be excluded regardless of band
const summary = summarizeComponentTotals(items);
eq('summarizeComponentTotals ignores non-component lots', summary.count, rtx4060Totals.length);
assertClose('summarizeComponentTotals.low matches robustBand', summary.low, band.low);
assertClose('summarizeComponentTotals.high matches robustBand', summary.high, band.high);

function assertClose(name: string, got: unknown, want: unknown): void {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — got ${got}, want ${want}`);
}

// buildBuyHelperQuoteQuery: baseline filters present even with no query params, and
// merged (not replaced) when the caller explicitly passes its own list.
const noParams = new URLSearchParams({ query: 'RTX 4060' });
const q1 = buildBuyHelperQuoteQuery(noParams, 'ebay');
assertIncludes('baseline smart filters on with no explicit params', q1.enabledSmartFilters, 'parts-defekt');
assertIncludes('baseline smart filters on with no explicit params (2)', q1.enabledSmartFilters, 'fake-replica');

const withExplicit = new URLSearchParams({ query: 'RTX 4060', enabledSmartFilters: 'empty-case' });
const q2 = buildBuyHelperQuoteQuery(withExplicit, 'ebay');
assertIncludes('explicit filters merge with baseline (baseline kept)', q2.enabledSmartFilters, 'parts-defekt');
assertIncludes('explicit filters merge with baseline (explicit kept)', q2.enabledSmartFilters, 'empty-case');

function assertIncludes(name: string, list: string[], id: string): void {
  const ok = Array.isArray(list) && list.includes(id);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — list=${JSON.stringify(list)}`);
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
