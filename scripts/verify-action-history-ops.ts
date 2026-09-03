/**
 * Audit history helpers: diffs, operation grouping, undo guards.
 * Run: npx tsx scripts/verify-action-history-ops.ts
 */
import assert from 'node:assert/strict';
import {
  canUndo,
  diffStates,
  makeHistoryEntry,
  mergeActionHistoryById,
  runOperation,
  getActiveOperation,
} from '../services/actionHistoryOps';
import { ItemStatus, type ActionHistoryEntry, type InventoryItem } from '../types';

const { previous_state, new_state } = diffStates(
  { buyPrice: 10, updated_at: 'old', name: 'A' },
  { buyPrice: 12, updated_at: 'new', name: 'A' }
);
assert.deepEqual(Object.keys(previous_state).sort(), ['buyPrice']);
assert.equal(new_state.buyPrice, 12);
assert.ok(!('updated_at' in previous_state));

const created = diffStates(null, { id: '1', name: 'X', buyPrice: 5 }, { fullSnapshot: true });
assert.equal(created.new_state.name, 'X');

let seen: string[] = [];
runOperation('Split PSU', () => {
  runOperation('inner should join', () => {
    seen.push(getActiveOperation()!.operationLabel);
    const e = makeHistoryEntry({ action: 'Buy price changed', actionType: 'buy_price_changed', itemId: 'a' });
    const e2 = makeHistoryEntry({ action: 'Item created', actionType: 'created', itemId: 'b' });
    assert.equal(e.operationId, e2.operationId);
    assert.equal(e.operationLabel, 'Split PSU');
  });
});
assert.deepEqual(seen, ['Split PSU']);

const sold: InventoryItem = {
  id: 'p1',
  name: 'Fan',
  buyPrice: 10,
  category: 'Components',
  status: ItemStatus.SOLD,
  buyDate: '2026-01-01',
};
const splitEntry: ActionHistoryEntry = {
  id: 'act-1',
  timestamp: '2026-09-03T10:00:00.000Z',
  action: 'Split into parts',
  actionType: 'bundle_split',
  itemId: 'p1',
  itemName: 'Fan',
  relatedItemIds: ['p1'],
};
const guard = canUndo(splitEntry, [splitEntry], [sold]);
assert.equal(guard.ok, false);
if (!guard.ok) {
  assert.match(guard.reason, /sold/i);
}

const a: ActionHistoryEntry = { id: 'x', timestamp: '1', action: 'A' };
const b: ActionHistoryEntry = { id: 'y', timestamp: '2', action: 'B' };
const merged = mergeActionHistoryById([a], [a, b]);
assert.equal(merged.length, 2);

console.log('verify-action-history-ops: ok');
