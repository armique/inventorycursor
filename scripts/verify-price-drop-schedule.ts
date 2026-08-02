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
  isLiveEbayListingForPriceDrop,
  isLiveKaListingForPriceDrop,
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

assert.equal(floorKa(100), 130);
assert.equal(nextKaPrice(100, 80, 0.05), 95);
assert.equal(sanitizeDropPct(0.5), MAX_DROP_PCT_PER_CYCLE);

const ebayFloor = floorEbay(100, 25);
assert.equal(ebayFloor, Math.ceil(130 / 0.75));
assert.ok(Math.abs(nextEbayPrice(200, ebayFloor, 0.05) - 190) < 0.02);

assert.equal(
  validatePriceTransition({
    buyPrice: 100,
    currentPrice: 150,
    nextPrice: 10,
    floorPrice: 130,
    channel: 'kleinanzeigen',
    feePct: 25,
  }).ok,
  false,
);
console.log('OK: floors + catastrophe guard');

const randomStock = item({
  id: 'rand',
  name: 'Random SSD',
  buyPrice: 40,
  sellPrice: 80,
  suggestedEbayListPrice: 90,
});
assert.equal(isLiveEbayListingForPriceDrop(randomStock), false);
assert.equal(isLiveKaListingForPriceDrop(randomStock), false);

const badgeOnly = item({
  id: 'badge',
  name: 'Badge only GPU',
  buyPrice: 100,
  listedOnEbay: true,
  sellPrice: 200,
});
assert.equal(isLiveEbayListingForPriceDrop(badgeOnly), false);

const liveEbay = item({
  id: 'live-eb',
  name: 'RTX 3060',
  buyPrice: 150,
  listedOnEbay: true,
  ebayListingId: '111',
  liveEbayListPrice: 280,
});
assert.equal(isLiveEbayListingForPriceDrop(liveEbay), true);
assert.equal(isLiveEbayListingForPriceDrop(liveEbay, new Set(['999'])), false);
assert.equal(isLiveEbayListingForPriceDrop(liveEbay, new Set(['111'])), true);

const viaParent = item({
  id: 'child',
  name: 'Kit child',
  buyPrice: 50,
  listedOnEbay: true,
  listedViaParent: true,
  ebayListingId: '111',
  liveEbayListPrice: 100,
});
assert.equal(isLiveEbayListingForPriceDrop(viaParent), false);
console.log('OK: only live matched listings (not random / badge-only / kit children)');

assert.ok(expandRamCapacityTokens('DDR4 2x8GB 3200').includes('16gb'));
assert.ok(priceDropNameSimilarity('Corsair 16GB DDR4', 'Corsair 2x8GB DDR4 3200') > 0.3);

const sample = [
  liveEbay,
  item({
    id: 'r1ka',
    name: 'RTX 3060 KA',
    buyPrice: 150,
    listedOnKleinanzeigen: true,
    kleinanzeigenListingUrl: 'https://www.kleinanzeigen.de/s-anzeige/rtx/1',
    liveKleinListPrice: 250,
  }),
  randomStock,
  badgeOnly,
];

const plan = buildPriceDropPlan(sample, { ebayFeePct: 12.5, ebayAdsPct: 12.5 }, {
  now: new Date('2026-08-01T10:00:00.000Z'),
  activeEbayListingIds: ['111'],
  activeKaListingUrls: ['https://www.kleinanzeigen.de/s-anzeige/rtx/1'],
});
assert.equal(plan.dropPct, DEFAULT_DROP_PCT);
assert.equal(plan.rows.length, 2, 'only live eBay + KA rows');
assert.ok(plan.rows.every((r) => r.listingIdOrUrl));
assert.ok(plan.rows.every((r) => (r.currentPrice || 0) > 0));

const payload = exportAgentPayload(plan);
assert.ok(payload.rows.every((r) => r.nextPrice >= r.buyPrice));
assert.ok(absoluteMinListPrice(100, 'kleinanzeigen', 25) >= 130);
console.log('OK: plan only includes marketplace-matched rows');

console.log('\nAll price-drop schedule checks passed.');
