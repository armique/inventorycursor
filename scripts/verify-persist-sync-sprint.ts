/**
 * Persistence / sync sprint (R1, R3, R2) correctness + packing bench.
 * Frozen quadratic packer is a verbatim snapshot of the pre-sprint loop in
 * services/firebaseService.ts (Blob + wrapSize of the growing shard).
 *
 * Run: npx tsx scripts/verify-persist-sync-sprint.ts
 */
import assert from 'node:assert/strict';
import { persistSnapshotToLocalStorage } from '../services/backgroundPersistence';
import type { InventoryItem } from '../types';
import { getDefaultDashboardPreferences } from '../services/dashboardPreferences';
import {
  EMPTY_ITEMS_WRAPPER_BYTES,
  FIRESTORE_CHUNK_BODY_MAX,
  jsonUtf8ByteSize,
  packItemsIntoShards,
  planSyncPackWrites,
  utf8ByteLength,
  wrappedItemsByteSize,
  type PreparedShardItem,
} from '../utils/firestoreShardPack';

/* ------------------------------------------------------------------ */
/* Frozen pre-sprint shard packer (verbatim algorithm)                */
/* ------------------------------------------------------------------ */

function frozenJsonByteSizeBlob(obj: unknown): number {
  return new Blob([JSON.stringify(obj)]).size;
}

function frozenChunkItemsQuadratic(rawItems: unknown[]): unknown[][] {
  const chunks: unknown[][] = [];
  let current: unknown[] = [];
  const wrapSize = (arr: unknown[]) => frozenJsonByteSizeBlob({ items: arr });

  for (let index = 0; index < rawItems.length; index++) {
    const item = rawItems[index];
    const oneSize = frozenJsonByteSizeBlob({ items: [item] });
    if (oneSize > FIRESTORE_CHUNK_BODY_MAX) {
      throw new Error('One row is too large for cloud sync even after shrinking.');
    }
    if (current.length > 0 && wrapSize([...current, item]) > FIRESTORE_CHUNK_BODY_MAX) {
      chunks.push(current);
      current = [];
    }
    current.push(item);
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function countStringifyDuring(fn: () => void): number {
  let n = 0;
  const orig = JSON.stringify;
  JSON.stringify = ((...args: Parameters<typeof JSON.stringify>) => {
    n += 1;
    return orig.apply(JSON, args);
  }) as typeof JSON.stringify;
  try {
    fn();
    return n;
  } finally {
    JSON.stringify = orig;
  }
}

function makeItem(i: number): Record<string, unknown> {
  return {
    id: `item-${String(i).padStart(4, '0')}`,
    name: `Corsair RM750x ${i}`,
    category: 'Components',
    subCategory: 'PSU',
    buyPrice: 40 + (i % 80),
    sellPrice: 0,
    status: 'In Stock',
    imageUrl: `https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/items%2F${i}.jpg?alt=media`,
    comment1: 'ok',
    vendor: 'Kleinanzeigen',
    buyDate: '2024-03-01',
    note: `row-${i}-pad-${'n'.repeat(80)}`,
  };
}

function prepareLinear(items: unknown[]): PreparedShardItem[] {
  return items.map((item) => ({
    item,
    utf8Bytes: utf8ByteLength(JSON.stringify(item)),
  }));
}

function installLocalStorage(): Map<string, string> {
  const map = new Map<string, string>();
  const ls = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true });
  return map;
}

function emptyPersistRest() {
  return {
    trashJson: '[]',
    expensesJson: '[]',
    settingsJson: '{}',
    monthlyGoal: '0',
    categoriesJson: '{}',
    categoryFieldsJson: '{}',
    recurringExpensesJson: '[]',
    dashboardPrefs: getDefaultDashboardPreferences(),
  };
}

/* ------------------------------------------------------------------ */
/* R3 — linear packing equals frozen quadratic; each shard under cap  */
/* ------------------------------------------------------------------ */

const N = 1998;
const items = Array.from({ length: N }, (_, i) => makeItem(i));
const avgBytes = Math.round(items.reduce((s, it) => s + jsonUtf8ByteSize(it), 0) / N);

assert.equal(EMPTY_ITEMS_WRAPPER_BYTES, utf8ByteLength('{"items":[]}'));
assert.equal(utf8ByteLength('café 😀'), new Blob(['café 😀']).size, 'utf8ByteLength must match Blob.size');

const sample = { items: items.slice(0, 3) };
assert.equal(jsonUtf8ByteSize(sample), new Blob([JSON.stringify(sample)]).size);

const prepared = prepareLinear(items);
for (let i = 0; i < 25; i++) {
  const lens = prepared.slice(0, i).map((p) => p.utf8Bytes);
  const subset = items.slice(0, i);
  assert.equal(
    wrappedItemsByteSize(lens),
    jsonUtf8ByteSize({ items: subset }),
    `wrapper size mismatch at n=${i}`
  );
}

let quadraticMs = 0;
let quadraticStringifies = 0;
let quadraticChunks: unknown[][] = [];
quadraticStringifies = countStringifyDuring(() => {
  const t0 = performance.now();
  quadraticChunks = frozenChunkItemsQuadratic(items);
  quadraticMs = performance.now() - t0;
});

let linearMs = 0;
let linearStringifies = 0;
let linearChunks: unknown[][] = [];
linearStringifies = countStringifyDuring(() => {
  const t0 = performance.now();
  const prep = prepareLinear(items);
  linearChunks = packItemsIntoShards(prep, FIRESTORE_CHUNK_BODY_MAX);
  linearMs = performance.now() - t0;
});

assert.equal(linearChunks.length, quadraticChunks.length, 'shard count must match frozen packer');
assert.deepEqual(
  linearChunks.map((c) => c.length),
  quadraticChunks.map((c) => c.length),
  'shard boundaries must match frozen packer'
);
assert.equal(linearChunks.flat().length, N);
for (let s = 0; s < linearChunks.length; s++) {
  const body = { items: linearChunks[s] };
  const bytes = jsonUtf8ByteSize(body);
  assert.ok(bytes <= FIRESTORE_CHUNK_BODY_MAX, `shard i${s} is ${bytes} bytes`);
  assert.deepEqual(linearChunks[s], quadraticChunks[s]);
}

assert.ok(
  linearStringifies <= N + 2,
  `linear packing should stringify each item once (got ${linearStringifies} for N=${N})`
);
assert.ok(
  quadraticStringifies >= N * 2 - 5,
  `quadratic packer should stringify once per item plus wrapSize of the growing shard (got ${quadraticStringifies})`
);

/* ------------------------------------------------------------------ */
/* R2 — skip unchanged shards                                         */
/* ------------------------------------------------------------------ */

const corePayload = {
  expenses: [],
  recurringExpenses: [],
  settings: { theme: 'dark' },
  goals: { monthly: 1000 },
  categories: {},
  categoryFields: {},
  dashboard: null,
  threeDPrint: null,
  actionHistory: [],
  bulkImports: [],
};

const meta = {
  schemaVersion: 2,
  inventoryChunks: linearChunks.length,
  trashChunks: 0,
  updatedAt: '2026-08-22T00:00:00.000Z',
  savedBy: 'user@example.com',
};

function existingFromChunks(chunks: unknown[][], core: Record<string, unknown>) {
  const map = new Map<string, Record<string, unknown>>();
  map.set('meta', { ...meta, updatedAt: '2026-01-01T00:00:00.000Z' });
  map.set('core', JSON.parse(JSON.stringify(core)) as Record<string, unknown>);
  chunks.forEach((chunk, i) => {
    map.set(`i${i}`, JSON.parse(JSON.stringify({ items: chunk })) as Record<string, unknown>);
  });
  return map;
}

// Unchanged inventory after restart (existing docs from JSON round-trip).
const unchangedPlan = planSyncPackWrites({
  invChunks: linearChunks,
  trashChunks: [],
  corePayload,
  meta: { ...meta, updatedAt: '2026-08-22T12:00:00.000Z' },
  existingById: existingFromChunks(linearChunks, corePayload),
});
assert.equal(unchangedPlan.setOps.length, 0, 'unchanged pack must write no documents');
assert.equal(unchangedPlan.deleteIds.length, 0);
assert.equal(unchangedPlan.metaWritten, false);
assert.ok(unchangedPlan.skippedIds.includes('meta'));
assert.ok(unchangedPlan.skippedIds.includes('core'));
assert.ok(unchangedPlan.skippedIds.includes('i0'));

// First write (no existing docs): every shard + core + meta.
const firstPlan = planSyncPackWrites({
  invChunks: linearChunks,
  trashChunks: [],
  corePayload,
  meta,
  existingById: new Map(),
});
assert.equal(firstPlan.metaWritten, true);
assert.equal(firstPlan.setOps.length, 1 + 1 + linearChunks.length, 'meta+core+iN');
assert.equal(firstPlan.setOps[0].id, 'meta');
assert.equal(firstPlan.deleteIds.length, 0);

// One item changed (first row) → only that shard + meta.
const oneChanged = linearChunks.map((chunk, i) =>
  i === 0
    ? [{ ...(chunk[0] as object), buyPrice: 99999 }, ...chunk.slice(1)]
    : chunk
);
const onePlan = planSyncPackWrites({
  invChunks: oneChanged,
  trashChunks: [],
  corePayload,
  meta: { ...meta, updatedAt: '2026-08-22T13:00:00.000Z' },
  existingById: existingFromChunks(linearChunks, corePayload),
});
assert.deepEqual(
  onePlan.setOps.map((o) => o.id).sort(),
  ['i0', 'meta'].sort(),
  'one item change must write meta + the shard that contains it'
);
assert.equal(onePlan.deleteIds.length, 0);
assert.ok(onePlan.skippedIds.includes('core'));
if (linearChunks.length > 1) {
  assert.ok(onePlan.skippedIds.includes(`i${linearChunks.length - 1}`));
}

// Multiple items in different shards.
const lastIdx = linearChunks.length - 1;
const multiChanged = linearChunks.map((chunk, i) => {
  if (i === 0) return [{ ...(chunk[0] as object), buyPrice: 1 }, ...chunk.slice(1)];
  if (i === lastIdx && lastIdx !== 0) {
    const last = chunk[chunk.length - 1] as object;
    return [...chunk.slice(0, -1), { ...last, buyPrice: 2 }];
  }
  return chunk;
});
const multiPlan = planSyncPackWrites({
  invChunks: multiChanged,
  trashChunks: [],
  corePayload,
  meta,
  existingById: existingFromChunks(linearChunks, corePayload),
});
const multiIds = multiPlan.setOps.map((o) => o.id).sort();
assert.ok(multiIds.includes('meta'));
assert.ok(multiIds.includes('i0'));
if (lastIdx !== 0) assert.ok(multiIds.includes(`i${lastIdx}`));
assert.ok(!multiIds.includes('core'));

// Shrinking: drop last inventory shard → delete leftover + rewrite remaining if needed.
const shrunk = linearChunks.slice(0, Math.max(1, linearChunks.length - 1));
const shrinkPlan = planSyncPackWrites({
  invChunks: shrunk,
  trashChunks: [],
  corePayload,
  meta: { ...meta, inventoryChunks: shrunk.length },
  existingById: existingFromChunks(linearChunks, corePayload),
});
assert.ok(shrinkPlan.deleteIds.includes(`i${linearChunks.length - 1}`));
assert.equal(shrinkPlan.metaWritten, true, 'chunk-count change must write meta');

// Missing shard doc must be written even if neighbors match (partial prior write).
const missingI0 = existingFromChunks(linearChunks, corePayload);
missingI0.delete('i0');
const missingPlan = planSyncPackWrites({
  invChunks: linearChunks,
  trashChunks: [],
  corePayload,
  meta,
  existingById: missingI0,
});
assert.ok(missingPlan.setOps.some((o) => o.id === 'i0'));
assert.ok(missingPlan.setOps.some((o) => o.id === 'meta'));
if (linearChunks.length > 1) {
  assert.ok(missingPlan.skippedIds.includes('i1') || linearChunks.length === 1);
}

/* ------------------------------------------------------------------ */
/* R1 — persist does not parse itemsJson when items are provided      */
/* ------------------------------------------------------------------ */

const store = installLocalStorage();
const persistItems = items.slice(0, 5) as unknown as InventoryItem[];
const itemsJson = JSON.stringify(persistItems);

await persistSnapshotToLocalStorage({
  items: persistItems,
  itemsJson,
  ...emptyPersistRest(),
});
assert.equal(store.get('inventory_items'), itemsJson, 'localStorage format unchanged');

let parseDuringR1 = 0;
{
  const orig = JSON.parse;
  JSON.parse = ((...args: Parameters<typeof JSON.parse>) => {
    parseDuringR1 += 1;
    return orig.apply(JSON, args);
  }) as typeof JSON.parse;
  await persistSnapshotToLocalStorage({
    items: persistItems,
    itemsJson,
    ...emptyPersistRest(),
  });
  JSON.parse = orig;
}
assert.equal(parseDuringR1, 0, 'R1 must not JSON.parse itemsJson when items is provided');

let parseDuringFallback = 0;
{
  const orig = JSON.parse;
  JSON.parse = ((...args: Parameters<typeof JSON.parse>) => {
    parseDuringFallback += 1;
    return orig.apply(JSON, args);
  }) as typeof JSON.parse;
  await persistSnapshotToLocalStorage({
    itemsJson,
    ...emptyPersistRest(),
  });
  JSON.parse = orig;
}
assert.ok(parseDuringFallback >= 1, 'fallback path still parses itemsJson when items is omitted');
assert.equal(store.get('inventory_items'), itemsJson);

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

const speedup = quadraticMs > 0 ? quadraticMs / Math.max(linearMs, 0.001) : 0;

console.log('verify-persist-sync-sprint: all checks passed');
console.log(
  JSON.stringify(
    {
      dataset: { items: N, avgItemJsonBytes: avgBytes, shards: linearChunks.length },
      packing: {
        quadraticMs: Math.round(quadraticMs * 100) / 100,
        linearMs: Math.round(linearMs * 100) / 100,
        speedup: Math.round(speedup * 10) / 10,
        quadraticStringifies,
        linearStringifies,
        stringifyReduction: `${quadraticStringifies} → ${linearStringifies}`,
      },
      firestoreWrites: {
        unchanged: unchangedPlan.setOps.length,
        firstWrite: firstPlan.setOps.length,
        oneItemChanged: onePlan.setOps.length,
        multiShardChanged: multiPlan.setOps.length,
        shrinkDeletes: shrinkPlan.deleteIds.length,
      },
    },
    null,
    2
  )
);
