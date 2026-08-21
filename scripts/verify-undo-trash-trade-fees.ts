/**
 * Verifies sandbox delete/restore undo snapshots, return/cancellation fee history,
 * and trade action-history merge stay reversible.
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import { appendUndoHistory, makeUndoSnapshot } from '../utils/appendUndoHistory';
import { applyUnsoldRestock } from '../services/saleRevert';
import { mergeTradeActionEntries } from '../services/tradeActionHistory';
import { applyTradeRevert } from '../services/tradeRevert';
import { listBuyPriceHistory } from '../services/priceHistory';

function item(partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'name'>): InventoryItem {
  return {
    category: 'Components',
    status: ItemStatus.IN_STOCK,
    buyPrice: 10,
    buyDate: '2025-01-01',
    ...partial,
  } as InventoryItem;
}

// --- Undo snapshot includes trash (delete ↔ restore) ---
const live = item({ id: 'gpu-1', name: 'GTX 1080', buyPrice: 100 });
const afterDelete = makeUndoSnapshot([], [live]);
const beforeDelete = makeUndoSnapshot([live], []);
const { base, nextIdx } = appendUndoHistory([], -1, beforeDelete, afterDelete);
assert.equal(nextIdx, 1);
assert.equal(base[0].items.length, 1);
assert.equal(base[0].trash.length, 0);
assert.equal(base[1].items.length, 0);
assert.equal(base[1].trash[0]?.id, 'gpu-1');

const afterRestore = makeUndoSnapshot([live], []);
const { base: base2, nextIdx: idx2 } = appendUndoHistory(base, nextIdx, afterDelete, afterRestore);
assert.equal(idx2, 2);
assert.equal(base2[2].items[0]?.id, 'gpu-1');
assert.equal(base2[2].trash.length, 0);

// --- Return / cancellation fee recorded on restock ---
const sold = item({
  id: 'gpu-fee',
  name: 'RX 580',
  status: ItemStatus.SOLD,
  buyPrice: 40,
  sellPrice: 80,
  sellDate: '2025-06-01',
  platformSold: 'eBay',
  ebayOrderId: '12-345',
});
const withFeePatch = {
  ...sold,
  status: ItemStatus.IN_STOCK,
  buyPrice: 46.5,
  sellPrice: undefined,
  sellDate: undefined,
  comment2: ' [Returned 1/1/2026: +€6.50 cost]',
};
const { updates } = applyUnsoldRestock([sold], [sold.id], { patches: [withFeePatch] });
const restocked = updates.find((u) => u.id === sold.id)!;
assert.equal(restocked.status, ItemStatus.IN_STOCK);
assert.ok(Math.abs(restocked.buyPrice - 46.5) < 0.01, `buyPrice ${restocked.buyPrice}`);
const buys = listBuyPriceHistory(restocked);
assert.ok(
  buys.some((e) => e.reason === 'restock_loss' && Math.abs((e.delta || 0) - 6.5) < 0.01),
  'expected return/cancellation fee in buy price history'
);

// --- Trade completed history + revert ---
const outgoing = item({
  id: 'out-1',
  name: 'Old PSU',
  status: ItemStatus.TRADED,
  buyPrice: 20,
  sellPrice: 50,
  sellDate: '2025-07-01T12:00:00.000Z',
  tradedForIds: ['in-1'],
  cashOnTop: -10,
});
const received = item({
  id: 'in-1',
  name: 'New PSU',
  buyPrice: 40,
  buyDate: '2025-07-01',
  tradedFromId: 'out-1',
});
const merged = mergeTradeActionEntries(
  [
    { id: 'a1', timestamp: '2025-07-01T12:00:00.000Z', action: 'Item created', itemId: 'in-1', itemName: 'New PSU' },
    {
      id: 'a2',
      timestamp: '2025-07-01T12:00:00.000Z',
      action: `Status changed: In Stock -> ${ItemStatus.TRADED}`,
      itemId: 'out-1',
      itemName: 'Old PSU',
    },
  ],
  [outgoing, received]
);
assert.equal(merged[0]?.action, 'Trade completed');
assert.ok(merged[0]?.tradeReceivedIds?.includes('in-1'));
assert.ok(String(merged[0]?.details || '').includes('cash out'));

const reverted = applyTradeRevert([outgoing, received], 'out-1', ['in-1'], 'SmallBusiness');
assert.equal(reverted.ok, true);
if (reverted.ok) {
  assert.equal(reverted.outgoingRestored.status, ItemStatus.IN_STOCK);
  assert.ok(!reverted.nextItems.some((i) => i.id === 'in-1'));
  assert.ok(reverted.removedIds.includes('in-1'));
}

console.log('verify-undo-trash-trade-fees: ok');
