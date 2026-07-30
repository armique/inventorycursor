/**
 * Fix German/Latin UTF-8 mojibake left after encoding damage
 * (ü→Ã¼, Ö→Ã– with en-dash, ×→Ã—, etc.).
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const cp = (...codes) => String.fromCodePoint(...codes);

/** Order matters: longer / more specific first. */
const LITERALS = [
  // German umlauts / sharp s / multiply (UTF-8 bytes re-read as Latin-1/CP1252)
  [cp(0xc3, 0xbc), 'ü'],
  [cp(0xc3, 0xb6), 'ö'],
  [cp(0xc3, 0xa4), 'ä'],
  [cp(0xc3, 0x9f), 'ß'],
  [cp(0xc3, 0x178), 'ß'], // CP1252 path: 0x9F → Ÿ
  [cp(0xc3, 0x9c), 'Ü'],
  [cp(0xc3, 0x153), 'Ü'], // CP1252 path: 0x9C → œ
  [cp(0xc3, 0x96), 'Ö'],
  [cp(0xc3, 0x2013), 'Ö'], // CP1252 path: 0x96 → –
  [cp(0xc3, 0x84), 'Ä'],
  [cp(0xc3, 0x97), '×'],
  [cp(0xc3, 0x2014), '×'], // CP1252 path: 0x97 → —
  [cp(0xc3, 0xa9), 'é'],
  [cp(0xc3, 0xa8), 'è'],
  [cp(0xc3, 0xa2), 'â'],
  [cp(0xc3, 0x89), 'É'],

  // Common emoji mojibake handled below in EMOJI_MOJIBAKE
];

const EMOJI_MOJIBAKE = [
  [cp(0xf0, 0x178, 0x2019, 0xbb), '💻'],
  [cp(0xf0, 0x178, 0x201d, 0xa7), '🔧'],
  [cp(0xf0, 0x178, 0x201d, 0xa5), '🔥'],
  [cp(0xf0, 0x178, 0x201c, 0xa6), '📦'],
  [cp(0xe2, 0x153, 0x2026), '✅'],
];

const files = [
  'services/specsAI.ts',
  'components/SettingsPage.tsx',
  'components/ListingAiPanelModal.tsx',
  'components/InventoryList.tsx',
  'scripts/verify-apply-listing.ts',
];

for (const file of files) {
  const p = path.join(ROOT, file);
  let text = fs.readFileSync(p, 'utf8');
  const before = text;
  const counts = [];

  for (const [from, to] of LITERALS) {
    if (!text.includes(from)) continue;
    const n = text.split(from).length - 1;
    text = text.split(from).join(to);
    counts.push(`${JSON.stringify(from)}→${JSON.stringify(to)} x${n}`);
  }
  for (const [from, to] of EMOJI_MOJIBAKE) {
    if (!text.includes(from)) continue;
    const n = text.split(from).length - 1;
    text = text.split(from).join(to);
    counts.push(`emoji→${to} x${n}`);
  }

  if (text !== before) {
    fs.writeFileSync(p, text, 'utf8');
    console.log('fixed', file);
    counts.forEach((c) => console.log(' ', c));
  } else {
    console.log('unchanged', file);
  }
}

// Report leftovers in these files
for (const file of files) {
  const s = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const left = s.match(/Ã[\u00A0-\u0178\u2013\u2014\u0153]/g) || [];
  const uniq = [...new Set(left)];
  if (uniq.length) console.log('LEFTOVER', file, uniq.map((u) => JSON.stringify(u)).join(' '));
}
