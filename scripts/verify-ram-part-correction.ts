/**
 * RAM OEM part-number correction (Hynix HMT351… ≠ 8GB DDR4).
 * Run: npx tsx scripts/verify-ram-part-correction.ts
 */
import assert from 'node:assert/strict';
import {
  correctRamSpecsFromPartNumber,
  decodeRamPartNumber,
  decodeSkHynixModulePn,
  extractOemRamPartNumber,
} from '../services/ramPartNumberCorrection';

function run() {
  const pn = extractOemRamPartNumber('SK Hynix HMT351U6EFR8C');
  assert.equal(pn, 'HMT351U6EFR8C');

  const decoded = decodeSkHynixModulePn('HMT351U6EFR8C');
  assert.ok(decoded);
  assert.equal(decoded!.memoryType, 'DDR3');
  assert.equal(decoded!.capacityGb, 4);
  assert.equal(decoded!.formFactor, 'UDIMM');

  const wrongAi = {
    'Memory Type': 'DDR4',
    'GB per Stick': '8GB',
    'Kit Capacity': '8GB',
    Speed: '2400 MHz',
  };
  const fixed = correctRamSpecsFromPartNumber(
    'SK Hynix HMT351U6EFR8C',
    'SK Hynix HMT351U6EFR8C 8GB DDR4',
    wrongAi,
    'Components:RAM'
  );
  assert.equal(String(fixed['Memory Type']).toUpperCase().includes('DDR3'), true);
  assert.equal(String(fixed['GB per Stick']), '4GB');
  assert.equal(String(fixed['Kit Capacity']), '4GB');

  const hmt41 = decodeRamPartNumber('HMT41GU6AFR8A');
  assert.ok(hmt41);
  assert.equal(hmt41!.memoryType, 'DDR3');
  assert.equal(hmt41!.capacityGb, 8);

  const samsung = decodeRamPartNumber('M378B5273DH0');
  assert.ok(samsung);
  assert.equal(samsung!.memoryType, 'DDR3');
  assert.equal(samsung!.capacityGb, 4);

  console.log('verify-ram-part-correction: all checks passed');
}

run();
