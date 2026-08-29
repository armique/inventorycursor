/**
 * Verify extractComponentKeys()/extractPrimaryComponentKey() against real +
 * representative titles.
 * Run: npx tsx scripts/verify-component-key-extractor.ts
 */
import assert from 'node:assert/strict';
import { extractComponentKeys, extractPrimaryComponentKey } from '../utils/componentKeyExtractor';

type Case = { title: string; expectedKey: string; expectedCategory: string; source: 'real' | 'synthetic' };

const cases: Case[] = [
  { title: 'Palit GeForce GTX 1080 GameRock Premium Edition 8GB', expectedKey: 'gpu:gtx1080', expectedCategory: 'gpu', source: 'real' },
  { title: 'ASUS NVIDIA GeForce RTX 4060 Dual OC 8GB GDDR6 Gaming Grafikkarte + OVP', expectedKey: 'gpu:rtx4060', expectedCategory: 'gpu', source: 'real' },
  { title: 'ZOTAC Gaming | NVIDIA Geforce RTX 2080 | 8GB GDDR6', expectedKey: 'gpu:rtx2080', expectedCategory: 'gpu', source: 'real' },
  { title: 'Intel Core i7-4790K - 4x 4.00GHz SR219 - Sockel 1150/LGA1150/H3 CPU', expectedKey: 'cpu:i7-4790k', expectedCategory: 'cpu', source: 'real' },
  { title: 'Intel Core i7-8700K (3.70 GHz, LGA 1151) Prozessor / CPU', expectedKey: 'cpu:i7-8700k', expectedCategory: 'cpu', source: 'real' },
  { title: 'SK hynix 16GB 2x8GB DDR5-5600 SO-DIMM Notebook RAM Laptop Mini-PC', expectedKey: 'ram:ddr5-16gb', expectedCategory: 'ram', source: 'real' },
  { title: '16GB DDR5 RAM Kit [2x 8GB] Micron PC5-5600B SODIMM – Einwandfrei!', expectedKey: 'ram:ddr5-16gb', expectedCategory: 'ram', source: 'real' },
  { title: 'WD 256GB PC SN530 M.2 PCIe3 X4 NVMe 2230 SSD (Z29)', expectedKey: 'storage:nvme-256gb', expectedCategory: 'storage', source: 'real' },
  { title: 'Crucial BX500 240GB 2.5 Zoll SSD SATA 6Gb/s', expectedKey: 'storage:ssd-256gb', expectedCategory: 'storage', source: 'real' },
  { title: 'MSI b450 Tomahawk Max', expectedKey: 'motherboard:b450', expectedCategory: 'motherboard', source: 'real' },
  { title: 'Ryzen 5 5500 + B450 Mainboard bundle', expectedKey: 'cpu:ryzen5-5500', expectedCategory: 'cpu', source: 'real' },
];

let failed = 0;
console.log('\n=== extractPrimaryComponentKey ===');
for (const c of cases) {
  const match = extractPrimaryComponentKey(c.title);
  const pass = match?.componentKey === c.expectedKey && match?.category === c.expectedCategory;
  if (!pass) failed += 1;
  console.log(`[${pass ? 'PASS' : 'FAIL'}] (${c.source}) "${c.title}"`);
  console.log(`       expected=${c.expectedKey} actual=${match ? `${match.componentKey} (${match.confidence})` : 'null'}`);
}

// Multi-component title (whole-PC style) — extractComponentKeys must find more than one.
const multi = extractComponentKeys('Gaming PC RTX 5070 Ryzen 7800X3D 32GB DDR5 1TB NVMe B650 Mainboard');
console.log('\n=== extractComponentKeys — multi-component title ===');
console.log('  input: "Gaming PC RTX 5070 Ryzen 7800X3D 32GB DDR5 1TB NVMe B650 Mainboard"');
for (const m of multi) console.log(`  found: ${m.componentKey} (${m.category}, ${m.confidence})`);
assert.ok(multi.some((m) => m.category === 'gpu'), 'must find GPU in whole-PC title');
assert.ok(multi.some((m) => m.category === 'cpu'), 'must find CPU in whole-PC title');
assert.ok(multi.some((m) => m.category === 'ram'), 'must find RAM in whole-PC title');
assert.ok(multi.some((m) => m.category === 'storage'), 'must find storage in whole-PC title');
assert.ok(multi.some((m) => m.category === 'motherboard'), 'must find motherboard in whole-PC title');

// Proximity regression check: "32GB DDR5" (RAM) and "1TB NVMe" (storage) must not cross-contaminate.
const ramMatch = multi.find((m) => m.category === 'ram');
const storageMatch = multi.find((m) => m.category === 'storage');
assert.equal(ramMatch?.componentKey, 'ram:ddr5-32gb', `RAM must read 32GB, not storage's 1TB — got ${ramMatch?.componentKey}`);
assert.equal(storageMatch?.componentKey, 'storage:nvme-1tb', `storage must read 1TB, not RAM's 32GB — got ${storageMatch?.componentKey}`);

console.log(`\nverify-component-key-extractor: ${cases.length - failed}/${cases.length} single-key cases ok, multi-component extraction ok.`);
if (failed) {
  console.error(`verify-component-key-extractor: FAILED — ${failed} case(s) broke.`);
  process.exit(1);
}
console.log('verify-component-key-extractor: ok');
