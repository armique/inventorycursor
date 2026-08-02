/**
 * One-parent membership invariants.
 * Run: npx tsx scripts/verify-container-membership-invariants.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import {
  enforceContainerMembershipInvariants,
  filterPartsAvailableForCompose,
  findPartsOwnedByOtherContainer,
} from '../utils/containerMembershipInvariants';

function part(partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'name'>): InventoryItem {
  return {
    buyPrice: 10,
    status: ItemStatus.IN_STOCK,
    category: 'Components',
    subCategory: 'CPU',
    buyDate: '2026-01-01',
    comment1: '',
    comment2: '',
    ...partial,
  } as InventoryItem;
}

const cpu = part({ id: 'cpu', name: 'Ryzen 7700', status: ItemStatus.IN_COMPOSITION, parentContainerId: 'pc-b' });
const gpu = part({ id: 'gpu', name: 'RTX 4070', status: ItemStatus.IN_COMPOSITION, parentContainerId: 'pc-b' });
const pcA = part({
  id: 'pc-a',
  name: 'Old shell',
  category: 'PC',
  isPC: true,
  isBundle: true, // dual flag — should normalize
  status: ItemStatus.SOLD,
  sellPrice: 1400,
  sellDate: '2024-01-16',
  componentIds: ['cpu', 'gpu'],
});
const pcB = part({
  id: 'pc-b',
  name: 'Real PC',
  category: 'PC',
  isPC: true,
  isBundle: false,
  status: ItemStatus.SOLD,
  sellPrice: 1400,
  sellDate: '2024-01-16',
  componentIds: ['cpu', 'gpu'],
});

const enforced = enforceContainerMembershipInvariants([pcA, pcB, cpu, gpu]);
assert.equal(enforced.changed, true);
assert.ok(enforced.deleteIds.includes('pc-a'), 'emptied sold shell deleted');
assert.equal(enforced.nextItems.some((i) => i.id === 'pc-a'), false);
const kept = enforced.nextItems.find((i) => i.id === 'pc-b')!;
assert.deepEqual(kept.componentIds, ['cpu', 'gpu']);
assert.equal(kept.isBundle, false);
assert.equal(enforced.nextItems.find((i) => i.id === 'cpu')!.parentContainerId, 'pc-b');

// Idempotent
const again = enforceContainerMembershipInvariants(enforced.nextItems);
assert.equal(again.changed, false);
assert.equal(again.nextItems, enforced.nextItems);

// Guard: cannot compose parts already owned
const blocked = findPartsOwnedByOtherContainer(['cpu', 'gpu'], enforced.nextItems);
assert.equal(blocked.length, 2);
const { available } = filterPartsAvailableForCompose([cpu, gpu], enforced.nextItems);
assert.equal(available.length, 0);

// Free stock parts are available
const ram = part({ id: 'ram', name: 'RAM' });
const free = filterPartsAvailableForCompose([ram], [...enforced.nextItems, ram]);
assert.equal(free.available.length, 1);

// Heal: listed without parentContainerId → attach once
const loose = part({ id: 'ssd', name: 'SSD', status: ItemStatus.IN_COMPOSITION });
const live = part({
  id: 'pc-live',
  name: 'Live PC',
  category: 'PC',
  isPC: true,
  status: ItemStatus.IN_STOCK,
  componentIds: ['ssd'],
});
const healed = enforceContainerMembershipInvariants([live, loose]);
assert.equal(healed.nextItems.find((i) => i.id === 'ssd')!.parentContainerId, 'pc-live');
assert.deepEqual(healed.nextItems.find((i) => i.id === 'pc-live')!.componentIds, ['ssd']);

console.log('verify-container-membership-invariants: ok');
