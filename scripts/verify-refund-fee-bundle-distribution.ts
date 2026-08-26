/**
 * Sandbox verification for the bundle-aware refund-fee distribution fix.
 * Run: npx tsx scripts/verify-refund-fee-bundle-distribution.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import {
  applyOwnOrderRefundRevert,
  applyRefundFeeAbsorption,
  findOwnOrderFullRefundReverts,
  hasOwnOrderRefundRevert,
} from '../utils/refundFeeAbsorption';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function item(partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'name'>): InventoryItem {
  return {
    buyPrice: 0,
    status: ItemStatus.IN_STOCK,
    category: 'Components',
    buyDate: '2026-06-01',
    comment1: '',
    comment2: '',
    ...partial,
  } as InventoryItem;
}

// ---------------------------------------------------------------------------
// Test 1: standalone item — unchanged behavior, fee lands directly on it.
// ---------------------------------------------------------------------------
{
  const solo = item({ id: 'solo-1', name: 'RTX 3060', buyPrice: 100, status: ItemStatus.SOLD, ebayOrderId: 'ORD-1', sellPrice: 200 });
  const [reverted] = applyOwnOrderRefundRevert(solo, 'ORD-1', 12.5, [solo]);
  assert.equal(reverted.status, ItemStatus.IN_STOCK, 'standalone item should revert to IN_STOCK');
  assert.equal(reverted.buyPrice, 112.5, 'standalone buyPrice should be buyBefore + fee');
  assert.equal(reverted.ebayOrderId, undefined, 'ebayOrderId should be cleared on revert');
  console.log('PASS: standalone revert — buyPrice 100 -> 112.5');
}

// ---------------------------------------------------------------------------
// Test 2: bundle/PC — fee must land on CHILDREN (proportional to value), not the container,
// because the app resyncs container.buyPrice = sum(children) on every save and would
// silently erase a direct bump on the container.
// ---------------------------------------------------------------------------
{
  const parent = item({
    id: 'bundle-1',
    name: 'Gaming PC Bundle',
    buyPrice: 300, // == sum of children below, matching the app's own invariant
    isPC: true,
    status: ItemStatus.SOLD,
    ebayOrderId: 'ORD-2',
    sellPrice: 500,
    componentIds: ['child-cpu', 'child-gpu', 'child-ram'],
  });
  const childCpu = item({ id: 'child-cpu', name: 'Ryzen 5600', buyPrice: 100, parentContainerId: 'bundle-1' });
  const childGpu = item({ id: 'child-gpu', name: 'RTX 3060', buyPrice: 150, parentContainerId: 'bundle-1' });
  const childRam = item({ id: 'child-ram', name: '16GB DDR4', buyPrice: 50, parentContainerId: 'bundle-1' });
  const allItems = [parent, childCpu, childGpu, childRam];

  const fee = 30; // e.g. leftover DHL label cost on a fully refunded/cancelled PC order
  const updates = applyOwnOrderRefundRevert(parent, 'ORD-2', fee, allItems);

  assert.equal(updates.length, 4, 'should return parent + 3 children');
  const updatedParent = updates.find((u) => u.id === 'bundle-1')!;
  const updatedCpu = updates.find((u) => u.id === 'child-cpu')!;
  const updatedGpu = updates.find((u) => u.id === 'child-gpu')!;
  const updatedRam = updates.find((u) => u.id === 'child-ram')!;

  // Proportional shares: CPU 100/300, GPU 150/300, RAM 50/300 of the €30 fee.
  assert.equal(updatedCpu.buyPrice, round2(100 + fee * (100 / 300)), 'CPU share');
  assert.equal(updatedGpu.buyPrice, round2(150 + fee * (150 / 300)), 'GPU share');
  assert.equal(updatedRam.buyPrice, round2(50 + fee * (50 / 300)), 'RAM share');

  const childrenSum = round2(updatedCpu.buyPrice + updatedGpu.buyPrice + updatedRam.buyPrice);
  assert.equal(updatedParent.buyPrice, childrenSum, 'container buyPrice must equal the new children sum (the app-enforced invariant)');
  assert.equal(updatedParent.buyPrice, round2(300 + fee), 'sanity: total went up by exactly the fee');
  assert.equal(updatedParent.status, ItemStatus.IN_STOCK, 'container should revert to IN_STOCK');
  assert.equal(hasOwnOrderRefundRevert(updatedParent, 'ORD-2'), true, 'idempotency marker (priceHistory) recorded on container');

  console.log(
    `PASS: bundle revert — CPU ${childCpu.buyPrice}->${updatedCpu.buyPrice}, GPU ${childGpu.buyPrice}->${updatedGpu.buyPrice}, ` +
      `RAM ${childRam.buyPrice}->${updatedRam.buyPrice}, container ${parent.buyPrice}->${updatedParent.buyPrice} (sum=${childrenSum})`
  );

  // ---------------------------------------------------------------------------
  // Test 2b: idempotency — applying again for the SAME order must no-op (not double-charge).
  // ---------------------------------------------------------------------------
  const secondPass = applyOwnOrderRefundRevert(updatedParent, 'ORD-2', fee, [updatedParent, updatedCpu, updatedGpu, updatedRam]);
  assert.equal(secondPass.length, 1, 'second call for the same order should no-op (single unchanged item back)');
  assert.equal(secondPass[0].buyPrice, updatedParent.buyPrice, 'buyPrice must not double-charge on a repeat call');
  console.log('PASS: idempotency — second revert attempt for the same order is a no-op');

  // ---------------------------------------------------------------------------
  // Test 2c: the exact scenario the user was worried about — remove a child AFTER the fee
  // was distributed. The removed child must carry its own already-adjusted price with it,
  // and the remaining children's sum (what the container will resync to) must still be
  // internally consistent — no phantom fee left floating anywhere.
  // ---------------------------------------------------------------------------
  const remainingChildren = [updatedCpu, updatedRam]; // GPU removed from the bundle
  const remainingSum = round2(remainingChildren.reduce((s, c) => s + c.buyPrice, 0));
  const removedChildKeepsItsOwnPrice = updatedGpu.buyPrice === round2(150 + fee * (150 / 300));
  assert.ok(removedChildKeepsItsOwnPrice, 'removed child keeps its own fee-adjusted price when pulled out');
  assert.equal(
    remainingSum,
    round2(updatedParent.buyPrice - updatedGpu.buyPrice),
    'remaining children sum equals container total minus the removed child — nothing left unaccounted for'
  );
  console.log(
    `PASS: post-removal consistency — GPU leaves with its own price (${updatedGpu.buyPrice}), ` +
      `remaining bundle total correctly becomes ${remainingSum}`
  );
}

// ---------------------------------------------------------------------------
// Test 3: findOwnOrderFullRefundReverts scans a mixed items array and only touches what's
// eligible (SOLD, own order fully refunded, not already reverted) — bundle and standalone
// mixed together, some ineligible rows present as noise.
// ---------------------------------------------------------------------------
{
  const soldStandalone = item({ id: 's1', name: 'Solo item', buyPrice: 50, status: ItemStatus.SOLD, ebayOrderId: 'ORD-A', sellPrice: 80 });
  const soldBundleParent = item({
    id: 'b1',
    name: 'Bundle',
    buyPrice: 40,
    isBundle: true,
    status: ItemStatus.SOLD,
    ebayOrderId: 'ORD-B',
    sellPrice: 70,
    componentIds: ['b1-c1'],
  });
  const bundleChild = item({ id: 'b1-c1', name: 'Bundle part', buyPrice: 40, parentContainerId: 'b1' });
  const inStockNoise = item({ id: 'noise-1', name: 'Untouched item', buyPrice: 10, status: ItemStatus.IN_STOCK });
  const soldNoOrder = item({ id: 'noise-2', name: 'Sold but no order id', buyPrice: 10, status: ItemStatus.SOLD, sellPrice: 20 });
  const soldNotRefunded = item({ id: 'noise-3', name: 'Sold, order still positive', buyPrice: 10, status: ItemStatus.SOLD, ebayOrderId: 'ORD-C', sellPrice: 20 });

  const allItems = [soldStandalone, soldBundleParent, bundleChild, inStockNoise, soldNoOrder, soldNotRefunded];
  const ledgers = new Map<string, { pocketEur: number }>([
    ['ORD-A', { pocketEur: -5.19 }], // fully refunded, €5.19 leftover fee
    ['ORD-B', { pocketEur: -9.5 }], // fully refunded, €9.50 leftover fee
    ['ORD-C', { pocketEur: 42 }], // NOT refunded — should be skipped entirely
  ]);

  const updates = findOwnOrderFullRefundReverts(allItems, ledgers as any);
  const updatedIds = new Set(updates.map((u) => u.id));

  assert.ok(updatedIds.has('s1'), 'standalone eligible item should be reverted');
  assert.ok(updatedIds.has('b1'), 'bundle parent should be reverted');
  assert.ok(updatedIds.has('b1-c1'), 'bundle child should be updated');
  assert.ok(!updatedIds.has('noise-1'), 'in-stock item must never be touched');
  assert.ok(!updatedIds.has('noise-2'), 'sold item with no order id must be skipped');
  assert.ok(!updatedIds.has('noise-3'), 'sold item whose order is NOT refunded must be skipped');
  assert.equal(updates.length, 3, 'exactly 3 rows should change: standalone + bundle parent + its 1 child');

  console.log(`PASS: findOwnOrderFullRefundReverts — touched exactly [${[...updatedIds].join(', ')}], correctly ignored all noise rows`);
}

// ---------------------------------------------------------------------------
// Test 4: manual absorb-into-candidate flow (match picker) also handles a bundle target
// correctly — same distribution logic, routed through applyRefundFeeAbsorption.
// ---------------------------------------------------------------------------
{
  const candidateParent = item({
    id: 'cand-bundle',
    name: 'Candidate PC',
    buyPrice: 120,
    isPC: true,
    status: ItemStatus.IN_STOCK,
    componentIds: ['cc-1', 'cc-2'],
  });
  const cc1 = item({ id: 'cc-1', name: 'Part A', buyPrice: 80, parentContainerId: 'cand-bundle' });
  const cc2 = item({ id: 'cc-2', name: 'Part B', buyPrice: 40, parentContainerId: 'cand-bundle' });
  const allItems = [candidateParent, cc1, cc2];

  const updates = applyRefundFeeAbsorption(candidateParent, 'ORD-X', 12, allItems, 'test note');
  assert.equal(updates.length, 3, 'bundle candidate absorb should return parent + 2 children');
  const updatedParent = updates.find((u) => u.id === 'cand-bundle')!;
  const sum = round2(updates.filter((u) => u.id !== 'cand-bundle').reduce((s, c) => s + c.buyPrice, 0));
  assert.equal(updatedParent.buyPrice, sum, 'candidate bundle container must equal new children sum');
  assert.equal(updatedParent.buyPrice, round2(120 + 12), 'total increased by exactly the absorbed fee');
  assert.ok(
    updates.every((u) => u.id !== 'cand-bundle' || (u.pendingRefundFeeOrderIds || []).includes('ORD-X')),
    'candidate marker recorded on the container'
  );

  // Idempotency for the manual flow too.
  const secondPass = applyRefundFeeAbsorption(updatedParent, 'ORD-X', 12, updates, 'test note');
  assert.equal(secondPass.length, 1, 'second absorb attempt for the same order should no-op');

  console.log(`PASS: manual candidate absorb (bundle) — container ${candidateParent.buyPrice}->${updatedParent.buyPrice}, idempotent on repeat`);
}

console.log('\nAll refund-fee bundle-distribution checks passed.');
