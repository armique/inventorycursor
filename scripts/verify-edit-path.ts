/**
 * Edit-path sprint: membership equivalence vs frozen pre-sprint implementations,
 * plus a packing-style bench of clone-all vs identity-preserving enforce.
 *
 * Run: npx tsx scripts/verify-edit-path.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import { isInventoryContainer, normalizeExclusiveContainerFlags } from '../utils/containerMembership';
import { isSoldOrTradedOnly } from '../utils/itemDisposition';
import {
  enforceContainerMembershipInvariants,
  findEmptyContainerShellIds,
} from '../utils/containerMembershipInvariants';
import { appendUndoHistory, makeUndoSnapshot } from '../utils/appendUndoHistory';

/* ------------------------------------------------------------------ */
/* Frozen pre-sprint membership (verbatim)                            */
/* ------------------------------------------------------------------ */

function frozenIsContainerRow(item: InventoryItem): boolean {
  return isInventoryContainer(item) || Boolean(item.isPC || item.isBundle);
}

function frozenPickOwnerParentId(
  parentIds: string[],
  byId: Map<string, InventoryItem>,
  child: InventoryItem
): string {
  const parents = parentIds
    .map((id) => byId.get(id))
    .filter((p): p is InventoryItem => Boolean(p && frozenIsContainerRow(p)));
  if (parents.length <= 1) return (parents[0] || byId.get(parentIds[0]!))!.id;

  const scored = parents.map((p) => {
    let score = 0;
    if (p.isPC) score += 8;
    if (!isSoldOrTradedOnly(p)) score += 4;
    if (child.sellDate && p.sellDate && child.sellDate.slice(0, 10) === p.sellDate.slice(0, 10)) {
      score += 6;
    }
    if (child.status === ItemStatus.IN_COMPOSITION) score += 2;
    return { id: p.id, score };
  });
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scored[0]!.id;
}

function frozenEnforce(items: InventoryItem[]) {
  if (items.length === 0) {
    return { nextItems: items, deleteIds: [] as string[], changed: false };
  }

  let changed = false;
  const working = items.map((i) => {
    const normalized = normalizeExclusiveContainerFlags(i);
    if (normalized !== i) changed = true;
    return { ...normalized };
  });
  const byId = new Map(working.map((i) => [i.id, i]));

  const touch = (item: InventoryItem, patch: Partial<InventoryItem>) => {
    const next = { ...item, ...patch };
    byId.set(item.id, next);
    const idx = working.findIndex((w) => w.id === item.id);
    if (idx >= 0) working[idx] = next;
    changed = true;
    return next;
  };

  for (const item of [...working]) {
    if (frozenIsContainerRow(item)) continue;
    const current = byId.get(item.id)!;
    const pid = current.parentContainerId;
    if (!pid) continue;
    const parent = byId.get(pid);
    if (!parent || !frozenIsContainerRow(parent)) {
      touch(current, { parentContainerId: undefined });
    }
  }

  const listedIn = new Map<string, string[]>();
  for (const container of working) {
    const c = byId.get(container.id)!;
    if (!frozenIsContainerRow(c)) continue;
    for (const id of c.componentIds || []) {
      if (!id || !byId.has(id)) continue;
      const child = byId.get(id)!;
      if (frozenIsContainerRow(child)) continue;
      const list = listedIn.get(id) || [];
      list.push(c.id);
      listedIn.set(id, list);
    }
  }

  const ownerOf = new Map<string, string>();
  for (const item of working) {
    if (frozenIsContainerRow(item)) continue;
    const current = byId.get(item.id)!;
    if (current.parentContainerId && byId.has(current.parentContainerId)) {
      ownerOf.set(current.id, current.parentContainerId);
      continue;
    }
    const listed = [...new Set(listedIn.get(current.id) || [])].filter((pid) => {
      const p = byId.get(pid);
      return Boolean(p && frozenIsContainerRow(p));
    });
    if (listed.length === 0) continue;

    const isSoldStandalone =
      (current.status === ItemStatus.SOLD ||
        current.status === ItemStatus.TRADED ||
        current.status === ItemStatus.GIFTED) &&
      current.status !== ItemStatus.IN_COMPOSITION;
    if (isSoldStandalone) continue;

    const winner = frozenPickOwnerParentId(listed, byId, current);
    ownerOf.set(current.id, winner);
    if (current.parentContainerId !== winner) {
      touch(current, { parentContainerId: winner });
    }
  }

  const childrenOf = new Map<string, string[]>();
  for (const [childId, parentId] of ownerOf) {
    const list = childrenOf.get(parentId) || [];
    list.push(childId);
    childrenOf.set(parentId, list);
  }

  const deleteIds: string[] = [];
  for (const container of [...working]) {
    if (!frozenIsContainerRow(container)) continue;
    const current = byId.get(container.id)!;
    const inputSnapshot = items.find((i) => i.id === current.id);
    const prev = current.componentIds || [];
    const owned = childrenOf.get(current.id) || [];
    const ownedSet = new Set(owned);
    const nextIds = [
      ...prev.filter((id) => ownedSet.has(id)),
      ...owned.filter((id) => !prev.includes(id)),
    ];
    const same = prev.length === nextIds.length && prev.every((id, i) => id === nextIds[i]);
    if (!same) {
      touch(current, { componentIds: nextIds });
    }

    const finalContainer = byId.get(container.id)!;
    if (
      (finalContainer.componentIds || []).length === 0 &&
      ((inputSnapshot?.componentIds || []).length > 0 || isSoldOrTradedOnly(finalContainer))
    ) {
      const stillHasLinkedChild = working.some(
        (c) => !frozenIsContainerRow(c) && c.parentContainerId === finalContainer.id,
      );
      if (!stillHasLinkedChild) deleteIds.push(finalContainer.id);
    }
  }

  const uniqueDelete = [...new Set(deleteIds)];
  let nextItems = working.map((w) => byId.get(w.id) || w);
  if (uniqueDelete.length > 0) {
    nextItems = nextItems.filter((i) => !uniqueDelete.includes(i.id));
    changed = true;
  }

  if (!changed) {
    return { nextItems: items, deleteIds: [] as string[], changed: false };
  }
  return { nextItems, deleteIds: uniqueDelete, changed: true };
}

function frozenFindEmpty(items: InventoryItem[]): string[] {
  return items
    .filter((container) => {
      if (!container.isPC && !container.isBundle) return false;
      const listed = new Set(container.componentIds || []);
      return !items.some((c) => {
        if (c.isPC || c.isBundle || c.id === container.id) return false;
        if (c.parentContainerId === container.id) return true;
        if (!listed.has(c.id)) return false;
        if (
          !c.parentContainerId &&
          (c.status === ItemStatus.SOLD ||
            c.status === ItemStatus.TRADED ||
            c.status === ItemStatus.GIFTED)
        ) {
          return false;
        }
        return true;
      });
    })
    .map((c) => c.id);
}

function part(id: string, extra: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id,
    name: id,
    buyPrice: 10,
    buyDate: '2025-01-01',
    category: 'Components',
    status: ItemStatus.IN_STOCK,
    comment1: '',
    comment2: '',
    ...extra,
  };
}

function pc(id: string, componentIds: string[], extra: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id,
    name: id,
    buyPrice: 100,
    buyDate: '2025-01-01',
    category: 'PC',
    status: ItemStatus.IN_STOCK,
    isPC: true,
    componentIds,
    comment1: '',
    comment2: '',
    ...extra,
  };
}

function assertSameResult(label: string, items: InventoryItem[]) {
  const a = frozenEnforce(items);
  const b = enforceContainerMembershipInvariants(items);
  assert.equal(a.changed, b.changed, `${label} changed`);
  assert.deepEqual(a.deleteIds, b.deleteIds, `${label} deleteIds`);
  assert.deepEqual(
    a.nextItems.map((i) => JSON.parse(JSON.stringify(i))),
    b.nextItems.map((i) => JSON.parse(JSON.stringify(i))),
    `${label} items`
  );
  if (!a.changed) {
    assert.equal(b.nextItems, items, `${label} must keep array identity when unchanged`);
  }
}

const consistentChild = part('gpu', { parentContainerId: 'pc1', status: ItemStatus.IN_COMPOSITION });
const consistentPc = pc('pc1', ['gpu']);
assertSameResult('consistent', [consistentPc, consistentChild]);
assertSameResult('empty', []);

assertSameResult('invalid parent', [part('gpu', { parentContainerId: 'missing' })]);
assertSameResult(
  'heal from listing',
  [pc('pc1', ['gpu']), part('gpu', { status: ItemStatus.IN_STOCK })]
);
assertSameResult(
  'sold standalone not attached',
  [
    pc('pc1', ['gpu']),
    part('gpu', { status: ItemStatus.SOLD, sellPrice: 50, sellDate: '2025-06-01' }),
  ]
);
assertSameResult(
  'empty sold shell',
  [pc('pc1', [], { status: ItemStatus.SOLD, sellPrice: 200, sellDate: '2025-06-01' })]
);
assertSameResult(
  'dual flags',
  [pc('pc1', ['gpu'], { isBundle: true }), part('gpu', { parentContainerId: 'pc1' })]
);
assertSameResult(
  'rewrite componentIds order',
  [
    pc('pc1', ['b', 'a']),
    part('a', { parentContainerId: 'pc1' }),
    part('b', { parentContainerId: 'pc1' }),
  ]
);

const emptyShells = [
  pc('empty', []),
  pc('alive', ['gpu']),
  part('gpu', { parentContainerId: 'alive' }),
  pc('stale-sold-list', ['soldpart']),
  part('soldpart', { status: ItemStatus.SOLD, sellPrice: 1 }),
];
assert.deepEqual(
  [...findEmptyContainerShellIds(emptyShells)].sort(),
  [...frozenFindEmpty(emptyShells)].sort()
);

/* Identity: no-op must not clone rows */
const noOp = [consistentPc, consistentChild];
const noOpOut = enforceContainerMembershipInvariants(noOp);
assert.equal(noOpOut.changed, false);
assert.equal(noOpOut.nextItems[0], consistentPc);
assert.equal(noOpOut.nextItems[1], consistentChild);

const sharedOther = part('other');
const sharedList = [pc('pc1', ['gpu']), part('gpu'), sharedOther];
const sharedOut = enforceContainerMembershipInvariants(sharedList);
assert.equal(sharedOut.nextItems.find((i) => i.id === 'other'), sharedOther);

/* Undo stack still records array snapshots by reference */
const snapA = makeUndoSnapshot(noOp, []);
const snapB = makeUndoSnapshot(sharedOut.nextItems, []);
const stacked = appendUndoHistory([], -1, snapA, snapB);
assert.equal(stacked.base.length, 2);
assert.equal(stacked.base[0].items, noOp);

/* ------------------------------------------------------------------ */
/* Bench: clone-all vs identity-preserving (1998 / 162 shaped)        */
/* ------------------------------------------------------------------ */

function makeDataset(nItems: number, nPc: number): InventoryItem[] {
  const items: InventoryItem[] = [];
  for (let p = 0; p < nPc; p++) {
    const childIds: string[] = [];
    for (let c = 0; c < 4; c++) {
      const id = `p${p}-c${c}`;
      childIds.push(id);
      items.push(
        part(id, {
          name: `Part ${id}`,
          parentContainerId: `pc-${p}`,
          status: ItemStatus.IN_COMPOSITION,
        })
      );
    }
    items.push(pc(`pc-${p}`, childIds, { name: `PC ${p}` }));
  }
  while (items.length < nItems) {
    const i = items.length;
    items.push(part(`solo-${i}`, { name: `Solo ${i}`, buyPrice: i % 90 }));
  }
  return items;
}

const dataset = makeDataset(1998, 162);
assertSameResult('dataset-shaped', dataset);
assert.deepEqual(
  [...findEmptyContainerShellIds(dataset)].sort(),
  [...frozenFindEmpty(dataset)].sort()
);

function timeMs(fn: () => void, loops: number): number {
  const t0 = performance.now();
  for (let i = 0; i < loops; i++) fn();
  return (performance.now() - t0) / loops;
}

const LOOPS = 40;
const frozenMs = timeMs(() => {
  frozenEnforce(dataset);
  frozenFindEmpty(dataset);
}, LOOPS);
const liveMs = timeMs(() => {
  enforceContainerMembershipInvariants(dataset);
  findEmptyContainerShellIds(dataset);
}, LOOPS);

const liveNoOp = enforceContainerMembershipInvariants(dataset);
const frozenNoOp = frozenEnforce(dataset);
assert.equal(liveNoOp.changed, false);
assert.equal(frozenNoOp.changed, false);
assert.equal(liveNoOp.nextItems, dataset);
assert.equal(frozenNoOp.nextItems, dataset);
assert.equal(liveNoOp.nextItems[0], dataset[0], 'live no-op keeps row identity');

console.log('verify-edit-path: all checks passed');
console.log(
  JSON.stringify(
    {
      dataset: { items: dataset.length, containers: 162 },
      membershipMs: {
        frozenCloneAllPass: Math.round(frozenMs * 100) / 100,
        live: Math.round(liveMs * 100) / 100,
        speedup: Math.round((frozenMs / Math.max(liveMs, 0.001)) * 10) / 10,
      },
      clonesOnNoOp: {
        frozenInternal: dataset.length,
        liveInternal: 0,
      },
    },
    null,
    2
  )
);
