/**
 * Buy price history records restock / Erstattet EK bumps with reason + delta.
 * Run: npx tsx scripts/verify-buy-price-history.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import {
  appendBuyPriceChange,
  appendPriceHistoryIfChanged,
  hasRestockBuyPriceBump,
  latestBuyPriceIncrease,
  listBuyPriceHistory,
  listSignificantBuyPriceHistory,
  stripBulkAllocationBuyHistory,
} from '../services/priceHistory';
import { applyUnsoldRestock } from '../services/saleRevert';

const base: InventoryItem = {
  id: 'gpu-1',
  name: 'MSI GTX 1080',
  buyPrice: 90,
  buyDate: '2025-01-01',
  category: 'Components',
  status: ItemStatus.SOLD,
  sellPrice: 150,
  sellDate: '2025-06-01',
  comment1: '',
  comment2: '',
};

const withLoss = appendBuyPriceChange(base, {
  buyBefore: 90,
  buyAfter: 96.19,
  reason: 'hub_erstattet',
  reasonLabel: 'Erstattet — fees/shipping +€6.19 EK · #12-345',
  orderId: '12-345',
});
assert.equal(withLoss.buyPrice, 96.19);
const hist = listBuyPriceHistory(withLoss);
assert.equal(hist.length, 1);
assert.equal(hist[0].delta, 6.19);
assert.equal(hist[0].reason, 'hub_erstattet');
assert.equal(hasRestockBuyPriceBump(withLoss), true);
const bump = latestBuyPriceIncrease(withLoss)!;
assert.equal(bump.delta, 6.19);
assert.equal(bump.previousPrice, 90);

// Manual edit still records history without restock badge reason
const manual = appendPriceHistoryIfChanged(withLoss, { ...withLoss, buyPrice: 100 });
assert.ok((manual.priceHistory || []).some((e) => e.type === 'buy' && e.reason === 'manual'));
assert.equal(listSignificantBuyPriceHistory(manual).length, 2);

// Generic / bulk allocation noise is hidden
const noisy: InventoryItem = {
  ...base,
  bulkImportId: 'lot-1',
  priceHistory: [
    {
      date: '2026-01-01',
      type: 'buy',
      price: 17.53,
      previousPrice: 22.46,
      delta: -4.93,
      reason: 'other',
      reasonLabel: 'Buy price change',
    },
  ],
};
assert.equal(listSignificantBuyPriceHistory(noisy).length, 0);
assert.equal((stripBulkAllocationBuyHistory(noisy).priceHistory || []).length, 0);

// Restock path with leftover allocation is covered by critical-flows; ensure delta=0 skips history
const noChange = appendBuyPriceChange(base, {
  buyBefore: 90,
  buyAfter: 90,
  reason: 'restock_loss',
});
assert.equal((noChange.priceHistory || []).length, 0);

// applyUnsoldRestock without refund orders leaves buy price (no loss) but still archives sale
const { updates } = applyUnsoldRestock([base], ['gpu-1']);
const restocked = updates.find((u) => u.id === 'gpu-1')!;
assert.equal(restocked.status, ItemStatus.IN_STOCK);
assert.equal(restocked.buyPrice, 90);

console.log('verify-buy-price-history: ok');
