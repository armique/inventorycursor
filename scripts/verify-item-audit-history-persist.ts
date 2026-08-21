/**
 * Audit fields (priceHistory / sale cycles) survive cloud merge + partial saves.
 * Run: npx tsx scripts/verify-item-audit-history-persist.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem, type PriceHistoryEntry } from '../types';
import { mergeItemAuditFields, mergePriceHistory } from '../services/priceHistory';

const histA: PriceHistoryEntry[] = [
  {
    date: '2026-01-01T00:00:00.000Z',
    type: 'buy',
    price: 90,
    previousPrice: 80,
    delta: 10,
    reason: 'hub_erstattet',
    reasonLabel: 'Erstattet +€10',
    orderId: '1',
  },
];
const histB: PriceHistoryEntry[] = [
  {
    date: '2026-02-01T00:00:00.000Z',
    type: 'buy',
    price: 95,
    previousPrice: 90,
    delta: 5,
    reason: 'manual',
  },
];

const mergedHist = mergePriceHistory(histA, histB)!;
assert.equal(mergedHist.length, 2);

const local: InventoryItem = {
  id: '1',
  name: 'GPU',
  buyPrice: 95,
  buyDate: '2025-01-01',
  category: 'Components',
  status: ItemStatus.IN_STOCK,
  priceHistory: histA,
  ebaySaleCycles: [
    {
      id: 'c1',
      closedAt: '2026-01-01T00:00:00.000Z',
      reason: 'erstattet',
      reasonLabel: 'Erstattet',
      buyPriceAtClose: 80,
      leftoverLossEur: 10,
    },
  ],
};
const remote: InventoryItem = {
  ...local,
  buyPrice: 90,
  priceHistory: histB,
  ebaySaleCycles: undefined,
};

const kept = mergeItemAuditFields(remote, local);
assert.equal((kept.priceHistory || []).length, 2);
assert.equal((kept.ebaySaleCycles || []).length, 1);
assert.ok((kept.priceHistory || []).some((e) => e.reason === 'hub_erstattet'));

console.log('verify-item-audit-history-persist: ok');
