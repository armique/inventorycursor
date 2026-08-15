/**
 * PC Bundle titles must not share an eBay listing just because both say "PC Bundle".
 * Run: npx tsx scripts/verify-ebay-bundle-match.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import {
  extractModelTokens,
  listingHardwareCompatible,
  scoreListingTitleMatch,
} from '../utils/ebayListingMatch';
import { applyEbayPresenceToItems, bestTitleMatch } from '../utils/listingPresence';
import type { EbayMyListing } from '../services/ebayService';

const a10 = 'PC Bundle · A10-6700';
const i7 = 'PC Bundle: ASRock H97 Pro4, Intel Core i7-4790K, 8GB DDR3 RAM';

assert.ok(
  extractModelTokens(a10).some((k) => k.includes('a10') || k.includes('6700')),
  'A10-6700 must produce a hardware token',
);
assert.equal(listingHardwareCompatible(a10, i7), false);
assert.equal(scoreListingTitleMatch(a10, i7), 0);
assert.equal(bestTitleMatch(a10, [{ title: i7, listingId: '111' }]), null);

assert.ok(listingHardwareCompatible(a10, 'PC Bundle A10-6700 8GB'));
assert.ok(scoreListingTitleMatch(a10, 'PC Bundle A10-6700 8GB') >= 40);

const item: InventoryItem = {
  id: 'bundle-a10',
  name: a10,
  buyPrice: 40,
  buyDate: '2026-01-01',
  category: 'Bundle',
  status: ItemStatus.IN_STOCK,
  comment1: '',
  comment2: '',
  isBundle: true,
  listedOnEbay: true,
  ebayListingId: '999',
  liveEbayListPrice: 89,
};

const listings: EbayMyListing[] = [
  {
    listingId: '999',
    title: i7,
    price: 89,
    sku: '',
    listingUrl: 'https://www.ebay.de/itm/999',
  } as EbayMyListing,
];

const next = applyEbayPresenceToItems([item], listings);
assert.equal(next[0].listedOnEbay, false);
assert.equal(next[0].ebayListingId, undefined);
assert.equal(next[0].maybeSoldHint, undefined);

console.log('verify-ebay-bundle-match: all checks passed');
