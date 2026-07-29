/**
 * Verify AI revert planning: clean field restore, conflict detection when the user
 * edited the same field afterwards, forced overwrite, and blocked cases.
 * Run: npx tsx scripts/verify-ai-revert.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type AiAction, type InventoryItem } from '../types';
import { applyRevert, planRevert } from '../services/aiActionRevert';

function item(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 'i1',
    name: 'RAM 16GB DDR4',
    buyPrice: 20,
    buyDate: '2026-07-01',
    category: 'RAM',
    status: ItemStatus.IN_STOCK,
    comment1: '',
    comment2: '',
    ...overrides,
  };
}

function action(overrides: Partial<AiAction> = {}): AiAction {
  return {
    id: 'a1',
    timestamp: '2026-07-23T10:00:00.000Z',
    actor: 'ai',
    actionType: 'item_updated',
    targetKind: 'item',
    itemId: 'i1',
    itemName: 'RAM 16GB DDR4',
    diff: [
      { field: 'buyPrice', oldValue: 20, newValue: 35 },
      { field: 'vendor', oldValue: null, newValue: 'Felix' },
    ],
    reviewStatus: 'unreviewed',
    reversible: true,
    ...overrides,
  };
}

// --- clean revert: the record still holds exactly what the AI wrote ---
{
  const current = item({ buyPrice: 35, vendor: 'Felix' });
  const plan = planRevert(action(), current);
  assert.equal(plan.blockedReason, undefined);
  assert.deepEqual(plan.conflicts, []);
  assert.deepEqual(plan.cleanFields.sort(), ['buyPrice', 'vendor']);

  const result = applyRevert(plan, current);
  assert.ok(result.item);
  assert.equal(result.item?.buyPrice, 20);
  assert.equal('vendor' in (result.item as object), false, 'empty oldValue clears the field');
  assert.equal(result.item?.aiReviewStatus, 'reverted');
  assert.equal(result.item?.lastModifiedBy, 'manual');
  assert.deepEqual(result.skippedFields, []);
}

// --- conflict: the user changed buyPrice by hand after the AI ---
{
  const current = item({ buyPrice: 40, vendor: 'Felix' });
  const plan = planRevert(action(), current);
  assert.deepEqual(plan.cleanFields, ['vendor']);
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].field, 'buyPrice');
  assert.equal(plan.conflicts[0].expected, 35);
  assert.equal(plan.conflicts[0].current, 40);
  assert.equal(plan.conflicts[0].restoreTo, 20);

  // Default: keep the manual edit, revert the rest.
  const kept = applyRevert(plan, current);
  assert.equal(kept.item?.buyPrice, 40, 'manual value survives');
  assert.deepEqual(kept.restoredFields, ['vendor']);
  assert.deepEqual(kept.skippedFields, ['buyPrice']);

  // Forced: user explicitly chose to overwrite.
  const forced = applyRevert(plan, current, { forceFields: ['buyPrice'] });
  assert.equal(forced.item?.buyPrice, 20);
  assert.deepEqual(forced.skippedFields, []);
}

// --- nothing to restore returns null so the caller can report it ---
{
  const current = item({ buyPrice: 40, vendor: 'Someone else' });
  const plan = planRevert(action(), current);
  assert.equal(plan.cleanFields.length, 0);
  assert.equal(plan.conflicts.length, 2);
  assert.equal(applyRevert(plan, current).item, null);
}

// --- blocked cases ---
assert.match(
  planRevert(action({ reversible: false }), item()).blockedReason || '',
  /not reversible/
);
assert.match(
  planRevert(action({ reviewStatus: 'reverted' }), item()).blockedReason || '',
  /Already reverted/
);
assert.match(
  planRevert(action({ actionType: 'item_deleted' }), item()).blockedReason || '',
  /Trash/
);
assert.match(planRevert(action(), undefined).blockedReason || '', /no longer exists/);
assert.match(planRevert(action({ diff: [] }), item()).blockedReason || '', /no field changes/);

// --- item_created is reversible but handled as a delete by the caller ---
{
  const plan = planRevert(action({ actionType: 'item_created' }), item());
  assert.equal(plan.blockedReason, undefined);
  assert.deepEqual(plan.cleanFields, []);
}

// --- nested paths round-trip through revert ---
{
  const buyerAction = action({
    diff: [{ field: 'customer.name', oldValue: null, newValue: 'Felix Matthes' }],
  });
  const current = item({ customer: { name: 'Felix Matthes', address: 'Berlin' } });
  const plan = planRevert(buyerAction, current);
  assert.deepEqual(plan.cleanFields, ['customer.name']);
  const result = applyRevert(plan, current);
  assert.equal(result.item?.customer?.name, undefined);
  assert.equal(result.item?.customer?.address, 'Berlin', 'untouched buyer fields stay');
}

console.log('verify-ai-revert: ok');
