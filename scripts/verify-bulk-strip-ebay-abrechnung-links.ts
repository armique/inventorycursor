/**
 * Bulk strip eBay Abrechnung links from inventory.
 * Run: npx tsx scripts/verify-bulk-strip-ebay-abrechnung-links.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import {
  bulkStripAllEbayAbrechnungLinks,
  bulkStripAllEbaySoldLinks,
  countEbayAbrechnungLinkedItems,
  countEbayLinkedSoldItems,
  isEbayAbrechnungLinkedItem,
  isEbayLinkedSoldItem,
} from '../utils/bulkStripEbayAbrechnungLinks';

const linked: InventoryItem = {
  id: 'a',
  name: 'GPU',
  buyPrice: 100,
  buyDate: '2026-01-01',
  status: ItemStatus.SOLD,
  category: 'Components',
  sellDate: '2026-08-23',
  sellPrice: 200,
  platformSold: 'ebay.de',
  paymentType: 'ebay.de',
  ebayOrderId: '11-11111-11111',
  saleProceeds: {
    capturedAt: new Date().toISOString(),
    source: 'ebay_order',
    buyerTotalEur: 200,
    netPayoutEur: 170,
    feesEstimated: false,
  },
};

const hubOnly: InventoryItem = {
  id: 'c',
  name: 'CPU',
  buyPrice: 50,
  buyDate: '2026-01-01',
  status: ItemStatus.SOLD,
  category: 'Components',
  sellDate: '2026-03-01',
  sellPrice: 90,
  platformSold: 'ebay.de',
  ebayOrderId: '22-22222-22222',
  saleProceeds: {
    capturedAt: new Date().toISOString(),
    source: 'ebay_seller_hub',
    buyerTotalEur: 90,
    netPayoutEur: 75,
    feesEstimated: false,
  },
};

const kleinanzeigen: InventoryItem = {
  id: 'b',
  name: 'RAM',
  buyPrice: 20,
  buyDate: '2026-01-01',
  status: ItemStatus.SOLD,
  category: 'Components',
  sellDate: '2026-03-01',
  sellPrice: 40,
  platformSold: 'kleinanzeigen.de',
};

assert.ok(isEbayAbrechnungLinkedItem(linked));
assert.ok(!isEbayAbrechnungLinkedItem(kleinanzeigen));
assert.ok(!isEbayAbrechnungLinkedItem(hubOnly));

const result = bulkStripAllEbayAbrechnungLinks([linked, kleinanzeigen, hubOnly]);
assert.equal(result.updates.length, 1);
assert.equal(result.updates[0]?.id, 'a');
assert.equal(result.updates[0]?.status, ItemStatus.IN_STOCK);
assert.equal(result.updates[0]?.sellDate, undefined);
assert.equal(result.updates[0]?.sellPrice, undefined);
assert.equal(result.updates[0]?.ebayOrderId, undefined);
assert.equal(result.updates[0]?.saleProceeds, undefined);
assert.equal(countEbayAbrechnungLinkedItems([result.updates[0]!, kleinanzeigen, hubOnly]), 0);

const hubSold = bulkStripAllEbaySoldLinks([hubOnly, kleinanzeigen]);
assert.equal(hubSold.updates.length, 1);
assert.equal(hubSold.updates[0]?.id, 'c');
assert.ok(!isEbayLinkedSoldItem(hubSold.updates[0]!, [kleinanzeigen]));

console.log('verify-bulk-strip-ebay-abrechnung-links: ok');
