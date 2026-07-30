/**
 * Verifies the fix for Buy Helper's "DDR4 32GB" search showing SODIMM/laptop RAM, server
 * ECC RDIMM mislabeled as desktop, 64/128GB multi-kits, and an unlabeled GPU+CPU rig — all
 * matched under a plain desktop-capacity search that should only return standalone 32GB
 * desktop DIMM kits.
 *
 * Run: npx tsx scripts/verify-buy-helper-ram-hard-rules.ts
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Dealwatch = require('../dealwatch-runtime/server.js');
const {
  isBlockedListing,
  normalizeListingText,
  classifyLotType,
  matchesRamTotalCapacity,
} = dealwatchRuntime;

let failures = 0;

function isAccepted(title: string, searchQuery: string): boolean {
  const haystack = normalizeListingText(title);
  return !isBlockedListing(title, '', '', searchQuery, [], '', []);
}

function assertRejected(name: string, title: string, searchQuery = 'DDR4 32GB'): void {
  const ok = !isAccepted(title, searchQuery);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — "${title}"`);
}

function assertAccepted(name: string, title: string, searchQuery = 'DDR4 32GB'): void {
  const ok = isAccepted(title, searchQuery);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — "${title}"`);
}

console.log('=== SODIMM/laptop RAM must be rejected under a plain desktop search ===');
assertRejected(
  'SODIMM kit rejected',
  'Crucial 32 GB Kit (2×16 GB) DDR4-2400 SODIMM Originalverpackung',
);
assertRejected(
  'Laptop-labeled RAM rejected',
  '32GB (2x16) DDR4 3200 mhz sodimm speicher memory laptop pc',
);
assertRejected(
  'Server ECC RDIMM rejected (not desktop wording)',
  'Micron 32GB DDR4 RAM RDIMM 2400MHz ECC PC4-2400T MTA36ASF4G72PZ-2G3B1IK Server',
);

console.log('\n=== A real SODIMM search must still accept SODIMM (symmetry check) ===');
assertAccepted(
  'SODIMM search accepts SODIMM listing',
  'Crucial 32 GB Kit (2×16 GB) DDR4-2400 SODIMM Originalverpackung',
  'DDR4 32GB SODIMM',
);

console.log('\n=== Total-kit-capacity mismatches must be rejected under "DDR4 32GB" ===');
assertRejected(
  '2x32GB=64GB kit rejected',
  'Corsair VENGEANCE LPX 64GB Kit (2x 32GB) DDR4 RAM 3200MHz CL16 Desktop Memory',
);
assertRejected(
  '4x32GB=128GB kit rejected',
  'Patriot DIMM 128 GB DDR4-3200 (4x 32 GB) Dual-Kit, Arbeitsspeicher PVB464G320C6K',
);
assertRejected(
  '64GB(2x32GB) kit rejected, brand-first title order',
  '64GB G.Skill TridentZ Neo RGB 3600MHz CL16 DDR4 RAM 2x 32GB',
);

console.log('\n=== Real 32GB kits must still be accepted ===');
assertAccepted(
  'Single-stick 1x32GB accepted',
  'Patriot Signature Series DDR4 32GB 1 x 32GB 3200MHz PC425600 SODIMM Single Ar...',
  'DDR4 32GB SODIMM', // this specific title is itself SODIMM-labeled — search for that channel
);
assertAccepted(
  '2x16GB=32GB kit accepted',
  'Corsair Vengeance LPX 32GB Kit (2x16GB) DDR4 3200MHz RAM Arbeitsspeicher CL16',
);
assertAccepted(
  '32GB (2x16GB) Kingston kit accepted',
  'Kingston HyperX Fury 32GB 2x16GB Kit 3200MHz DDR4 RAM HX432C16FB4K232',
);

console.log('\n=== matchesRamTotalCapacity unit checks ===');
function eq(name: string, got: unknown, want: unknown): void {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — got ${got}, want ${want}`);
}
eq('2x16=32 matches target 32', matchesRamTotalCapacity(normalizeListingText('32GB (2x16GB) kit'), 32), true);
eq('2x32=64 rejects target 32', matchesRamTotalCapacity(normalizeListingText('64GB (2x32GB) kit'), 32), false);
eq('no capacity parsed passes through', matchesRamTotalCapacity(normalizeListingText('DDR4 RAM stick'), 32), true);
eq('no target given passes through', matchesRamTotalCapacity(normalizeListingText('64GB (2x32GB) kit'), NaN), true);

console.log('\n=== classifyLotType: GPU+CPU co-mention bundle still excluded from RAM comps ===');
const bundleLot = classifyLotType(normalizeListingText('Gaming Setup R7 5800X RTX3060 WQHD 32gb DDR4 RAM'));
eq('bundle rig classified as donor_bundle (not component)', bundleLot, 'donor_bundle');

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
