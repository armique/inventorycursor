/**
 * Product card spec sanity — drop anachronistic / wrong-category rows.
 * Run: npx tsx scripts/verify-product-card-spec-sanity.ts
 */
import assert from 'node:assert/strict';
import {
  isPreM2EraPlatform,
  sanitizeProductCardSpecs,
  buildProductCardSpecGuardrails,
} from '../utils/productCardSpecSanity';

assert.equal(isPreM2EraPlatform('asus p5q pro lga775'), true);
assert.equal(isPreM2EraPlatform('msi b550-a pro am4'), false);
assert.equal(isPreM2EraPlatform('gigabyte z77x ud5h'), true);

const oldBoard = sanitizeProductCardSpecs(
  [
    { label: 'Socket', value: 'LGA775' },
    { label: 'Chipset', value: 'P45' },
    { label: 'M.2', value: '2x NVMe' },
    { label: 'Wi-Fi', value: 'Wi-Fi 6E' },
    { label: 'Memory', value: 'DDR3' },
    { label: 'Form Factor', value: 'ATX' },
  ],
  { name: 'ASUS P5Q Pro', category: 'Components', subCategory: 'Motherboards' }
);
assert.deepEqual(
  oldBoard.map((s) => s.label),
  ['Socket', 'Chipset', 'Memory', 'Form Factor']
);

const modernBoard = sanitizeProductCardSpecs(
  [
    { label: 'Socket', value: 'AM4' },
    { label: 'Chipset', value: 'B550' },
    { label: 'M.2', value: '2x NVMe' },
    { label: 'Memory', value: 'DDR4' },
  ],
  { name: 'MSI B550-A PRO', category: 'Components', subCategory: 'Motherboards' }
);
assert.ok(modernBoard.some((s) => s.label === 'M.2'));

const oldGpu = sanitizeProductCardSpecs(
  [
    { label: 'VRAM', value: '4 GB' },
    { label: 'Ray Tracing', value: 'Yes' },
    { label: 'DLSS', value: 'Yes' },
    { label: 'Socket', value: 'AM4' },
  ],
  { name: 'GTX 970', category: 'Components', subCategory: 'Graphics Cards' }
);
assert.deepEqual(
  oldGpu.map((s) => s.label),
  ['VRAM']
);

const sataSsd = sanitizeProductCardSpecs(
  [
    { label: 'Capacity', value: '1 TB' },
    { label: 'Interface', value: 'SATA' },
    { label: 'Form Factor', value: '2.5"' },
    { label: 'Protocol', value: 'NVMe' },
  ],
  { name: 'Samsung 870 EVO 1TB 2.5 SATA', category: 'Components', subCategory: 'Storage (SSD/HDD)' }
);
assert.ok(!sataSsd.some((s) => /nvme/i.test(s.value)));

const guard = buildProductCardSpecGuardrails(
  { name: 'ASUS P5Q', category: 'Components', subCategory: 'Motherboards' },
  [{ label: 'Socket', value: 'LGA775' }]
);
assert.match(guard, /pre-M\.2|M\.2/i);

console.log('verify-product-card-spec-sanity: ok');
