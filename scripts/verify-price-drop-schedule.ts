/**
 * Price Drop schedule checks.
 * Run: npx tsx scripts/verify-price-drop-schedule.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import {
  absoluteMinListPrice,
  buildPriceDropPlan,
  expandRamCapacityTokens,
  exportAgentPayload,
  floorEbay,
  floorKa,
  floorPocket,
  nextEbayPrice,
  nextKaPrice,
  priceDropNameSimilarity,
  sanitizeDropPct,
  validatePriceTransition,
  FLOOR_MARGIN,
  DEFAULT_DROP_PCT,
  MAX_DROP_PCT_PER_CYCLE,
} from '../utils/priceDropSchedule';

function item(partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'name'>): InventoryItem {
  return {
    buyPrice: 0,
    sellPrice: 0,
    status: ItemStatus.IN_STOCK,
    category: 'Components',
    subCategory: 'RAM',
    buyDate: '2026-06-01',
    ...partial,
  } as InventoryItem;
}

assert.equal(floorPocket(100), 130);
assert.equal(FLOOR_MARGIN, 0.3);
console.log('OK: floor pocket = buy × 1.30');

assert.equal(floorKa(100), 130);
assert.equal(nextKaPrice(100, 80, 0.05), 95);
assert.equal(Number.isInteger(nextKaPrice(100, 80, 0.05)), true);
assert.equal(nextKaPrice(82, 80, 0.05), 80);
assert.equal(nextKaPrice(80, 80, 0.05), 80);
console.log('OK: KA next is whole euros and respects floor');

const ebayFloor = floorEbay(100, 25);
assert.equal(ebayFloor, Math.ceil(130 / 0.75));
const ebayNext = nextEbayPrice(200, ebayFloor, 0.05);
assert.ok(ebayNext >= ebayFloor);
assert.ok(Math.abs(ebayNext - 190) < 0.02);
console.log('OK: eBay floor after 25% fees; 5% step');

assert.equal(nextEbayPrice(180, 174, 0.05), 174);
assert.equal(nextKaPrice(85, 84, 0.05), 84);
console.log('OK: never drops below floor');

assert.equal(sanitizeDropPct(0.5), MAX_DROP_PCT_PER_CYCLE);
assert.equal(sanitizeDropPct(0.05), 0.05);
console.log('OK: drop pct capped at 8%');

const disaster = validatePriceTransition({
  buyPrice: 100,
  currentPrice: 150,
  nextPrice: 10,
  floorPrice: 130,
  channel: 'kleinanzeigen',
  feePct: 25,
});
assert.equal(disaster.ok, false);
console.log('OK: rejects €100→€10 catastrophe');

const steep = validatePriceTransition({
  buyPrice: 100,
  currentPrice: 200,
  nextPrice: 150,
  floorPrice: 130,
  channel: 'kleinanzeigen',
  feePct: 25,
});
assert.equal(steep.ok, false);
console.log('OK: rejects >8% single-step drop');

const safe = validatePriceTransition({
  buyPrice: 100,
  currentPrice: 200,
  nextPrice: 190,
  floorPrice: 130,
  channel: 'kleinanzeigen',
  feePct: 25,
});
assert.equal(safe.ok, true);
console.log('OK: accepts normal 5% step');

assert.ok(absoluteMinListPrice(100, 'kleinanzeigen', 25) >= 130);
assert.ok(absoluteMinListPrice(100, 'ebay', 25) >= Math.ceil(130 / 0.75));
console.log('OK: absolute min list ≥ buy and fee floor');

assert.ok(expandRamCapacityTokens('DDR4 2x8GB 3200').includes('16gb'));
assert.ok(priceDropNameSimilarity('Corsair 16GB DDR4', 'Corsair 2x8GB DDR4 3200') > 0.3);
console.log('OK: RAM 2x8GB ↔ 16GB normalize');

const sample = [
  item({
    id: 'r1',
    name: 'RTX 3060 12GB',
    buyPrice: 150,
    listedOnEbay: true,
    ebayListingId: '123456',
    liveEbayListPrice: 280,
    listedOnKleinanzeigen: true,
    kleinanzeigenListingUrl: 'https://www.kleinanzeigen.de/s-anzeige/rtx/1',
    liveKleinListPrice: 250,
  }),
  item({
    id: 'r2',
    name: 'Unlisted part',
    buyPrice: 40,
    status: ItemStatus.IN_STOCK,
  }),
];

const plan = buildPriceDropPlan(sample, { ebayFeePct: 12.5, ebayAdsPct: 12.5 }, {
  now: new Date('2026-08-01T10:00:00.000Z'),
});
assert.equal(plan.dropPct, DEFAULT_DROP_PCT);
assert.ok(plan.nextDueAt.startsWith('2026-08-04'));
assert.equal(plan.rows.length, 2);
const ebayRow = plan.rows.find((r) => r.channel === 'ebay')!;
const kaRow = plan.rows.find((r) => r.channel === 'kleinanzeigen')!;
assert.equal(ebayRow.status, 'ready');
assert.equal(kaRow.status, 'ready');
assert.ok(ebayRow.nextPrice! < ebayRow.currentPrice!);
assert.equal(Number.isInteger(kaRow.nextPrice), true);
assert.equal(kaRow.matchConfidence, 'high');

const payload = exportAgentPayload(plan);
assert.equal(payload.rows.length, 2);
assert.ok(payload.safety.maxDropPctPerCycle <= 0.08);
assert.ok(payload.rows.every((r) => r.nextPrice < r.currentPrice));
assert.ok(payload.rows.every((r) => r.nextPrice >= r.minAllowedPrice));
assert.ok(payload.rows.every((r) => r.buyPrice > 0 && r.nextPrice >= r.buyPrice));
console.log('OK: plan build + safe agent export');

console.log('\nAll price-drop schedule checks passed.');
