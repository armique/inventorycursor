/**
 * Verify suggestBuyHelperTargetsFromDealwatch() — the new market-grounded path added
 * alongside (not replacing) suggestBuyHelperTargets(). Confirms:
 *  - falls back to the existing inventory-only suggestion when no Dealwatch signal exists
 *  - uses Dealwatch data (sellEbay/sellKa) when present, computed through the SAME
 *    untouched channelNet/maxBuyForNetMargin/pocketFromXList fee math
 *  - missing one channel's Dealwatch data falls back per-channel, not all-or-nothing
 * Run: npx tsx scripts/verify-buy-helper-dealwatch-bridge.ts
 */
import assert from 'node:assert/strict';
import {
  suggestBuyHelperTargetsFromDealwatch,
  maxBuyForNetMargin,
  pocketFromEbayList,
  pocketFromKaList,
  type BuyHelperFees,
} from '../utils/buyHelper';
import type { ResolvedDealwatchPrices } from '../services/dealwatchPriceSource';

const fees: BuyHelperFees = { ebayFeePct: 12.5, ebayAdsPct: 12.5, vatOnProfitPct: 19 };
const desired = 35;

console.log('\n=== Dealwatch = null (never checked), no inventory comps -> falls back to "no comps" message ===');
const noDealwatch = suggestBuyHelperTargetsFromDealwatch(null, [], 'RTX 3060 12GB', fees, { desiredMarginPct: desired });
console.log(noDealwatch);
assert.equal(noDealwatch.buyPrice, undefined, 'must not invent a buy price with no signal at all');
assert.ok(!noDealwatch.note?.startsWith('Dealwatch:'), 'when Dealwatch was never checked, note must not claim a Dealwatch check happened');

console.log('\n=== Dealwatch checked but BOTH channels empty -> must say so explicitly, not silently ===');
const emptyDealwatch: ResolvedDealwatchPrices = { ebay: null, ka: null };
const checkedEmpty = suggestBuyHelperTargetsFromDealwatch(emptyDealwatch, [], 'Obscure Part XYZ', fees, { desiredMarginPct: desired });
console.log(checkedEmpty);
assert.equal(checkedEmpty.buyPrice, undefined, 'must not invent a buy price when Dealwatch was checked and empty, and inventory has no comps either');
assert.ok(
  checkedEmpty.note?.includes('no live/sold data found'),
  `must explicitly say the Dealwatch was checked and came back empty, got: ${checkedEmpty.note}`,
);
assert.equal(noDealwatch.inventoryCompCount, 0, 'must surface zero comps, same as suggestBuyHelperTargets would alone');
assert.ok(noDealwatch.note && noDealwatch.note.length > 0, 'must still surface some explanatory note, not silence');

console.log('\n=== both channels have Dealwatch data ===');
const bothChannels: ResolvedDealwatchPrices = {
  ebay: { source: 'ebay-sold', median: 100, low: 80, high: 120, count: 5 },
  ka: { source: 'ka-live', median: 70, low: 60, high: 80, count: 3 },
};
const both = suggestBuyHelperTargetsFromDealwatch(bothChannels, [], 'RTX 3060 12GB', fees, { desiredMarginPct: desired });
console.log(both);
assert.equal(both.sellEbay, 100, 'sellEbay must come from the eBay-sold signal');
assert.equal(both.sellKa, 70, 'sellKa must come from the KA-live signal');
assert.equal(both.marketLow, 60, 'marketLow must be the min across both channels');
assert.equal(both.marketHigh, 120, 'marketHigh must be the max across both channels');
assert.equal(both.marketMedian, 85, 'marketMedian must be the average of the two channel medians');
assert.ok(both.note?.includes('eBay sold (n=5)'), `note must label the eBay source, got: ${both.note}`);
assert.ok(both.note?.includes('KA live (n=3)'), `note must label the KA source, got: ${both.note}`);

// buyPrice must be the min of the two channel caps, computed via the SAME untouched formulas.
const expectedMaxBuyEbay = maxBuyForNetMargin(pocketFromEbayList(100, fees), desired, fees.vatOnProfitPct);
const expectedMaxBuyKa = maxBuyForNetMargin(pocketFromKaList(70), desired, fees.vatOnProfitPct);
const expectedBuyPrice = Math.min(expectedMaxBuyEbay, expectedMaxBuyKa);
assert.ok(
  Math.abs((both.buyPrice ?? 0) - expectedBuyPrice) < 0.01,
  `buyPrice must equal min(maxBuyForNetMargin(...)) via existing formulas — expected ~${expectedBuyPrice}, got ${both.buyPrice}`,
);

console.log('\n=== only eBay live has data (no KA signal, no inventory fallback either) ===');
const ebayOnly: ResolvedDealwatchPrices = {
  ebay: { source: 'ebay-live', median: 90, low: 70, high: 110, count: 8 },
  ka: null,
};
const onlyEbay = suggestBuyHelperTargetsFromDealwatch(ebayOnly, [], 'RTX 3060 12GB', fees, { desiredMarginPct: desired });
console.log(onlyEbay);
assert.equal(onlyEbay.sellEbay, 90);
assert.equal(onlyEbay.sellKa, undefined, 'sellKa must stay undefined, not a bogus 0, when neither Dealwatch nor inventory has KA data');
assert.ok(onlyEbay.note?.includes('eBay live (n=8)'), `must label as "live" not "sold" for this source, got: ${onlyEbay.note}`);
assert.ok(!onlyEbay.note?.includes('KA live'), 'must not mention KA when there is no KA signal');
const expectedEbayOnlyBuy = maxBuyForNetMargin(pocketFromEbayList(90, fees), desired, fees.vatOnProfitPct);
assert.ok(
  Math.abs((onlyEbay.buyPrice ?? 0) - expectedEbayOnlyBuy) < 0.01,
  `buyPrice must be capped by the eBay channel alone, expected ~${expectedEbayOnlyBuy}, got ${onlyEbay.buyPrice}`,
);

console.log('\nverify-buy-helper-dealwatch-bridge: ok');
