/**
 * Run: npx tsx scripts/verify-ebay-marketplace-stats.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import { summarizeEbayMarketplaceCosts } from '../utils/ebayMarketplaceStats';

const base: InventoryItem = {
  id: 'a',
  name: 'GPU',
  buyPrice: 80,
  buyDate: '2026-01-01',
  category: 'Components',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  platformSold: 'ebay.de',
  sellDate: '2026-08-01',
  sellPrice: 150,
  saleProceeds: {
    capturedAt: '2026-08-01T00:00:00.000Z',
    source: 'ebay_seller_hub',
    buyerTotalEur: 150,
    transactionFeeEur: 18,
    adFeeEur: 12,
    shippingLabelEur: 0,
    netPayoutEur: 120,
  },
};

const stats = summarizeEbayMarketplaceCosts([base]);
assert.equal(stats.saleCount, 1);
assert.equal(stats.ebayFeeEur, 18);
assert.equal(stats.adFeeEur, 12);
assert.equal(stats.netEur, 120);
assert.equal(stats.avgTakePct, 20, '€150 sold / €120 kept = 20% lost to eBay');

const toshiba: InventoryItem = {
  ...base,
  id: 'b',
  name: 'HDD',
  buyPrice: 8,
  sellPrice: 25.52,
  saleProceeds: {
    capturedAt: '2026-08-18T00:00:00.000Z',
    source: 'ebay_seller_hub',
    buyerTotalEur: 25.52,
    transactionFeeEur: 2.06,
    adFeeEur: 2.74,
    shippingLabelEur: 2.9,
    netPayoutEur: 17.82,
  },
};
const mixed = summarizeEbayMarketplaceCosts([base, toshiba]);
assert.equal(mixed.ebayFeeEur, 20.06);
assert.equal(mixed.adFeeEur, 14.74);
assert.equal(mixed.avgTakePct, 21.48);

const ka: InventoryItem = {
  ...base,
  id: 'c',
  platformSold: 'kleinanzeigen.de',
  saleProceeds: undefined,
  feeAmount: 0,
};
assert.equal(summarizeEbayMarketplaceCosts([ka]).saleCount, 0, 'ignore Kleinanzeigen');

console.log('verify-ebay-marketplace-stats: ok');
