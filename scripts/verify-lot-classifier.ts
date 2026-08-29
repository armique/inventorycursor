/**
 * Verify classifyLotType() in dealwatch-runtime/server.js against real + representative titles.
 * Run: npx tsx scripts/verify-lot-classifier.ts
 *
 * Requires dealwatch-runtime/.env (EBAY_CLIENT_ID/SECRET) to be present — dealwatch-runtime/server.js
 * loads/validates them at module scope, same as when running `npm run dev:dealwatch`.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Dealwatch = require('../dealwatch-runtime/server.js');
const { classifyLotType, normalizeListingText } = Dealwatch;

type Case = { title: string; expected: string; note: string; source: 'real' | 'synthetic' };

// Titles marked "real" are copied verbatim from this project's own
// dealwatch-runtime/data/store.json (real eBay sold-comp / watchlist titles).
const mustPass: Case[] = [
  {
    title: 'Gaming PC RTX 5070 Ryzen 7800X3D',
    expected: 'whole_pc',
    note: 'The exact contamination case from Problem A — GPU mentioned inside a whole-PC title.',
    source: 'synthetic',
  },
  {
    title: 'ASUS NVIDIA GeForce RTX 4060 Dual OC 8GB GDDR6 Gaming Grafikkarte + OVP',
    expected: 'component',
    note: 'Real card with OVP box mentioned — must NOT be excluded as accessory-only.',
    source: 'real',
  },
  {
    title: 'Gainward RTX 4060 Pegasus 8GB | Neue Wärmeleitpaste | Getestet | OVP Von 3050',
    expected: 'component',
    note: 'Real card, bare "OVP" mention without "nur/ohne" wording — must stay component.',
    source: 'real',
  },
  {
    title: 'Palit GeForce GTX 1080 GameRock Premium Edition 8GB',
    expected: 'component',
    note: 'Clean single-GPU listing.',
    source: 'real',
  },
  {
    title: 'Intel Core i7-4790K - 4x 4.00GHz SR219 - Sockel 1150/LGA1150/H3 CPU',
    expected: 'component',
    note: 'Clean single-CPU listing.',
    source: 'real',
  },
  {
    title: 'fujitsu mini pc i3-4160 8Gb Keine Festplatte ',
    expected: 'whole_pc',
    note: 'Colloquial lowercase whole-PC listing, no storage.',
    source: 'real',
  },
  {
    title: 'Acer Veriton M275 - Intel Pentium E5700@3,0 GHz -4GB RAM 160GB HDD -ohne Windows',
    expected: 'whole_pc',
    note: 'Branded whole PC without an OS — must not be misread as "just parts".',
    source: 'real',
  },
  {
    title: 'office pc i5-4590 8gb ram',
    expected: 'whole_pc',
    note: 'Very terse colloquial Kleinanzeigen-style whole-PC listing.',
    source: 'real',
  },
  {
    title: 'KONVOLUT 2x Dell Wyse 3040 Mini PC Thin Client Atom X5-Z8350, 2GB RAM, 8GB eMMC',
    expected: 'donor_bundle',
    note: 'Konvolut of whole PCs — bundle wording must win over whole_pc.',
    source: 'real',
  },
  {
    title: 'Ryzen 5 5500 + B450 Mainboard bundle',
    expected: 'donor_bundle',
    note: 'CPU+mobo sold together as an explicit bundle.',
    source: 'real',
  },
  {
    title: 'Gemischt RAM Arbeitsspeicher Konvolut Module/Riegel mehrere Stück',
    expected: 'donor_bundle',
    note: 'Mixed-lot RAM Konvolut.',
    source: 'real',
  },
  {
    title: 'Alte Grafikkarten, Konvolut Verschiedener, Funktionierender Modelle',
    expected: 'donor_bundle',
    note: 'Multi-GPU Konvolut lot.',
    source: 'real',
  },
  {
    title: '6x HP Netzteil PC Netzteile Konvolut – 70W bis 320W',
    expected: 'donor_bundle',
    note: 'PSU Konvolut.',
    source: 'real',
  },
  // Previously a known limitation: looksLikeCompletePc()'s RAM/DIMM-kit guard never matched
  // normalized "so dimm" (hyphen collapsed to space by normalizeListingText), and its cancel-list
  // wrongly treated "mini-pc"/"komplett" as whole-system evidence instead of RAM-compatibility
  // wording. Fixed in dealwatch-runtime/server.js; promoted from known-limitation to must-pass so a
  // regression here fails the build, not just gets silently reported.
  {
    title: 'SK hynix 16GB 2x8GB DDR5-5600 SO-DIMM Notebook RAM Laptop Mini-PC',
    expected: 'component',
    note: 'Real RAM listing — "Mini-PC" here means "compatible with", not "this is a PC".',
    source: 'real',
  },
  {
    title: 'SK Hynix 1x16GB DDR5 4800 SODIMM(Laptop, Mini Pcs) RAM',
    expected: 'component',
    note: 'Same false-positive pattern, second real occurrence — not a one-off.',
    source: 'real',
  },
  // Found via a live "RTX 4060" buy-helper quote: ~13 of 28 matched listings were
  // protective cases/brackets/thermal modules (dragging the low band to €22) or
  // whole laptops/laptop-mainboards (dragging the high band to €2164), because none
  // of these wordings were covered by the accessory/whole-PC classifiers. Fixed in
  // dealwatch-runtime/server.js (accessoryPatterns, replacementPartPatterns, hasPcComputeSignal,
  // looksLikeCompletePc's literal laptop/notebook check).
  {
    title: 'Bracket For   RTX 4060 VENTUS 2X OC Graphics Video Card #lk',
    expected: 'accessory_only',
    note: 'GPU support bracket, not the card — was misclassified as component at €22.',
    source: 'real',
  },
  {
    title: 'Für RTX 4060 4070Ti 4080S für 4090 Grafikkarte Aufbewahrungsbox EVA Material S',
    expected: 'accessory_only',
    note: 'EVA storage box for a card, not the card itself.',
    source: 'real',
  },
  {
    title: 'Wasserdichtes EVA Grafikkartengehäuse passend für RTX 4060 4070Ti 4080S für 4',
    expected: 'accessory_only',
    note: 'EVA protective case, proximity-matched (word "Grafikkarte" sits between "EVA" and "gehaeuse").',
    source: 'real',
  },
  {
    title: 'Tragbare schwarze EVA Grafikkarte Aufbewahrungstasche für RTX 4060 4070Ti 4080S',
    expected: 'accessory_only',
    note: 'Carrying bag for a card — caught by the standalone "aufbewahrungstasche" pattern.',
    source: 'real',
  },
  {
    title: 'Heat sink thermal module For Gigabyte G5 KF KF5 G5 RTX4060 6-31-NP5K2-102 #zn',
    expected: 'accessory_only',
    note: 'Replacement laptop heatsink module — was sitting right at the reported median (€201.17).',
    source: 'real',
  },
  {
    title: 'Lenovo Legion 5 NVIDIA GeForce RTX 4060  Gaming Laptop in sehr gutem Zustand',
    expected: 'whole_pc',
    note: 'Literal "Gaming Laptop" wording, no CPU model or storage keywords to trigger the old brand+compute rule.',
    source: 'real',
  },
  {
    title: 'Lenovo Thinkbook 16p G4 IRH Laptop 16 Zoll i7-13700H RTX 4060',
    expected: 'whole_pc',
    note: 'Bare "i7-13700H" without the word "Core" — old compute-signal regex required "Core i7".',
    source: 'real',
  },
  {
    title: 'PC Gamer ASUS TUF GAMING A707 - i7 12th gen RTX 4060 - Bon état',
    expected: 'whole_pc',
    note: '"i7 12th gen" generation wording instead of a model number.',
    source: 'real',
  },
  {
    title: 'Lenovo 5B21M50969 Legion Mainboard Intel i9-14900HX RTX 4060 5 16IRX9 ~D~',
    expected: 'whole_pc',
    note: 'Laptop mainboard at €1506 — bare "i9-14900HX" now recognized as a compute signal.',
    source: 'real',
  },
  {
    title: '5B21L51768 Lenovo Motherboard R7 7840HS RTX 4060 Mainboard 8GB ~D~',
    expected: 'whole_pc',
    note: 'Laptop mainboard at €2164 (the exact outlier reported by the user) — bare "R7 7840HS" Ryzen model without the word "Ryzen".',
    source: 'real',
  },
  {
    title: 'ASUS NVIDIA GeForce RTX 4060 Dual OC 8GB GDDR6 Gaming Grafikkarte + OVP',
    expected: 'component',
    note: 'Re-asserts the existing must-pass case still holds after the accessory/compute-signal changes above.',
    source: 'real',
  },
  // Found via a live "DDR4 32GB" buy-helper quote: SODIMM laptop RAM, 64/128GB multi-kits,
  // and an unlabeled GPU+CPU rig all matched under a plain desktop-capacity search. These
  // three are handled by failsRamHardRules() (search-time hard rule, verified in
  // verify-buy-helper-ram-hard-rules.ts) rather than classifyLotType, so they're not
  // repeated here — this file only covers the new GPU+CPU co-mention classifier rule.
  {
    title: 'Gaming Setup R7 5800X RTX3060 WQHD 32gb DDR4 RAM',
    expected: 'donor_bundle',
    note: 'No "PC"/"bundle" wording at all, but a specific GPU model (RTX3060) and CPU model (R7 5800X) are both named — an assembled rig, not standalone RAM.',
    source: 'real',
  },
  {
    title: 'Gaming PC RTX 5070 Ryzen 7800X3D',
    expected: 'whole_pc',
    note: 'Also matches the new GPU+CPU co-mention rule, but explicit "Gaming PC" wording must still win (checked first) — re-asserts the very first must-pass case is unaffected.',
    source: 'synthetic',
  },
];

function run(cases: Case[]): Array<Case & { actual: string; pass: boolean }> {
  return cases.map((c) => {
    const actual = classifyLotType(normalizeListingText(c.title));
    return { ...c, actual, pass: actual === c.expected };
  });
}

const mustPassResults = run(mustPass);

console.log('\n=== classifyLotType — must-pass cases ===');
for (const r of mustPassResults) {
  const status = r.pass ? 'PASS' : 'FAIL';
  console.log(`[${status}] (${r.source}) "${r.title}"`);
  console.log(`       expected=${r.expected} actual=${r.actual} — ${r.note}`);
}

const failed = mustPassResults.filter((r) => !r.pass);
console.log(`\nverify-lot-classifier: ${mustPassResults.length - failed.length}/${mustPassResults.length} must-pass ok.`);

if (failed.length) {
  console.error(`verify-lot-classifier: FAILED — ${failed.length} must-pass case(s) broke.`);
  process.exit(1);
}
console.log('verify-lot-classifier: ok');
