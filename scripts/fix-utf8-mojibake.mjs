/**
 * Restore UTF-8 characters corrupted when special chars were mis-encoded as CP1252 mojibake
 * (e.g. € → â‚¬, whose trailing ¬ looks like a minus before amounts).
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const cp = (...codes) => String.fromCodePoint(...codes);

// Detected in InventoryList.tsx after the Dealwatch rename commit.
const LITERALS = [
  [cp(0xe2, 0x201a, 0xac), cp(0x20ac)], // â‚¬ → €
  [cp(0xe2, 0x20ac, 0x201d), cp(0x2014)], // â€” → —
  [cp(0xe2, 0x20ac, 0x201c), cp(0x2013)], // â€“ → –
  [cp(0xe2, 0x20ac, 0xa6), cp(0x2026)], // â€¦ → …
  [cp(0xe2, 0x20ac, 0x153), cp(0x201c)], // â€œ → “
  [cp(0xe2, 0x20ac, 0x9d), cp(0x201d)], // â€ → ”
  [cp(0xe2, 0x20ac, 0xa2), cp(0x2022)], // â€¢ → •
  [cp(0xe2, 0x20ac, 0xba), cp(0x203a)], // â€º → ›
  [cp(0xe2, 0x2020, 0x2019), cp(0x2192)], // â†’ → →
  [cp(0xe2, 0x2020, 0x2018), cp(0x2191)], // â†‘ → ↑
  [cp(0xe2, 0x2020, 0x201c), cp(0x2193)], // â†“ → ↓
  [cp(0xe2, 0x2020, 0x2014), cp(0x2197)], // â†— → ↗
  [cp(0xe2, 0x2c6, 0x2019), cp(0x2212)], // âˆ’ → −
  [cp(0xe2, 0x161, 0xa0), cp(0x26a0)], // âš + NBSP → ⚠ (approx; may need ⚠ without NBSP)
  [cp(0xc2, 0xb7), cp(0xb7)], // Â· → ·
  [cp(0xc2, 0xb2), cp(0xb2)], // Â² → ²
  [cp(0xc2, 0xb1), cp(0xb1)], // Â± → ±
];

const files = [
  'App.tsx',
  'components/InventoryList.tsx',
  'components/ListingAiPanelModal.tsx',
  'components/ListingStudioModal.tsx',
  'components/SettingsPage.tsx',
  'designs/item-card-ai-menu/README.md',
  'public/designs/item-card-ai-menu/README.md',
  'scripts/verify-apply-listing.ts',
  'services/specsAI.ts',
];

for (const file of files) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) {
    console.log('skip missing', file);
    continue;
  }
  let text = fs.readFileSync(p, 'utf8');
  const before = text;
  const counts = [];
  for (const [from, to] of LITERALS) {
    if (!text.includes(from)) continue;
    const n = text.split(from).length - 1;
    text = text.split(from).join(to);
    counts.push(`${[...from].map((c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase()).join(' ')} x${n}`);
  }
  if (text !== before) {
    fs.writeFileSync(p, text, 'utf8');
    console.log('fixed', file, '→', counts.join('; '));
  } else {
    console.log('unchanged', file);
  }
}

const sampleFile = fs.readFileSync(path.join(ROOT, 'components/InventoryList.tsx'), 'utf8');
const idx = sampleFile.indexOf('formatEUR(item.buyPrice)');
console.log('sample:', JSON.stringify(sampleFile.slice(Math.max(0, idx - 8), idx + 28)));

// Remaining â/Â starters
const left = [];
for (let i = 0; i < sampleFile.length; i++) {
  const c = sampleFile.codePointAt(i);
  if (c === 0xe2 || c === 0xc2) {
    left.push(JSON.stringify(sampleFile.slice(i, i + 3)));
  }
}
console.log('remaining â/Â clusters:', [...new Set(left)]);
