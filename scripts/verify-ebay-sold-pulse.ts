/**
 * Verify Sold Pulse URL builders + paste price extraction.
 * Run: npx tsx scripts/verify-ebay-sold-pulse.ts
 */
import assert from 'node:assert/strict';
import {
  buildEbaySoldUrl,
  extractPricesFromPaste,
  summarizePriceList,
} from '../utils/ebaySoldPulse';

const bin = buildEbaySoldUrl('RTX 3060 12GB', 'used_bin');
assert.ok(bin.includes('ebay.de/sch'));
assert.ok(bin.includes('LH_Sold=1'));
assert.ok(bin.includes('LH_Complete=1'));
assert.ok(bin.includes('LH_BIN=1'));
assert.ok(bin.includes('LH_ItemCondition=3000'));

const parts = buildEbaySoldUrl('RTX 3060', 'for_parts');
assert.ok(parts.includes('LH_ItemCondition=7000'));
assert.ok(!parts.includes('LH_BIN=1'));

const prices = extractPricesFromPaste('ASUS Dual RTX 3060 12GB 189,00 € · MSI 175€ · EUR 210.50');
assert.deepEqual(prices, [189, 175, 210.5]);

const sum = summarizePriceList([100, 110, 120, 200]);
assert.ok(sum);
assert.equal(sum!.median, 115);

console.log('verify-ebay-sold-pulse: ok');
