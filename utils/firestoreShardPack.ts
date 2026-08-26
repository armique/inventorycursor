/**
 * Linear Firestore sync-pack helpers.
 *
 * Inventory is stored as `{ items: InventoryItem[] }` documents capped at
 * FIRESTORE_CHUNK_BODY_MAX bytes (JSON UTF-8). Packing must not re-stringify
 * the growing shard on every item.
 */

/** Max JSON size per shard document (Firestore hard limit ~1 MiB per doc). */
export const FIRESTORE_CHUNK_BODY_MAX = 680 * 1024;

const textEncoder = new TextEncoder();

/** UTF-8 byte length of a string. Matches `new Blob([s]).size`. */
export function utf8ByteLength(text: string): number {
  return textEncoder.encode(text).byteLength;
}

/** UTF-8 byte length of `JSON.stringify(value)`. */
export function jsonUtf8ByteSize(value: unknown): number {
  return utf8ByteLength(JSON.stringify(value));
}

/** `JSON.stringify({ items: [] })` — ASCII wrapper around an empty shard body. */
export const EMPTY_ITEMS_WRAPPER_BYTES = jsonUtf8ByteSize({ items: [] });

export type PreparedShardItem = {
  item: unknown;
  utf8Bytes: number;
};

/**
 * Byte size of `{ items: [item0, item1, ...] }` given each item's JSON UTF-8 length.
 * Equivalent to `jsonUtf8ByteSize({ items })` for JSON-serializable objects.
 */
export function wrappedItemsByteSize(itemUtf8Lengths: number[]): number {
  if (itemUtf8Lengths.length === 0) return EMPTY_ITEMS_WRAPPER_BYTES;
  let sum = EMPTY_ITEMS_WRAPPER_BYTES;
  for (let i = 0; i < itemUtf8Lengths.length; i++) {
    sum += itemUtf8Lengths[i];
    if (i > 0) sum += 1; // comma between array elements
  }
  return sum;
}

/**
 * Split prepared items into shards so each `{ items }` JSON stays ≤ maxBytes.
 * Linear: uses per-item UTF-8 lengths; does not stringify the growing chunk.
 */
export function packItemsIntoShards(
  prepared: PreparedShardItem[],
  maxBytes: number = FIRESTORE_CHUNK_BODY_MAX
): unknown[][] {
  const chunks: unknown[][] = [];
  let current: unknown[] = [];
  let running = EMPTY_ITEMS_WRAPPER_BYTES;

  for (const { item, utf8Bytes } of prepared) {
    const extra = current.length === 0 ? utf8Bytes : utf8Bytes + 1;
    if (current.length > 0 && running + extra > maxBytes) {
      chunks.push(current);
      current = [];
      running = EMPTY_ITEMS_WRAPPER_BYTES;
    }
    if (current.length === 0) {
      current.push(item);
      running = EMPTY_ITEMS_WRAPPER_BYTES + utf8Bytes;
    } else {
      current.push(item);
      running += utf8Bytes + 1;
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export function shardBodiesJsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export type SyncPackMeta = {
  schemaVersion: number;
  inventoryChunks: number;
  trashChunks: number;
  updatedAt: string;
  savedBy: string;
};

export type SyncPackSetOp = {
  id: string;
  data: Record<string, unknown>;
};

export type SyncPackWritePlan = {
  setOps: SyncPackSetOp[];
  deleteIds: string[];
  skippedIds: string[];
  metaWritten: boolean;
  contentWrites: number;
};

/**
 * Decide which syncPack documents to set/delete by comparing packed payloads
 * to the documents already present (from getDocs). Restart-safe: no RAM cache.
 *
 * meta.updatedAt is written only when at least one content shard changes or a
 * leftover shard must be deleted — so a no-op sync does not bump timestamps.
 */
export function planSyncPackWrites(args: {
  invChunks: unknown[][];
  trashChunks: unknown[][];
  corePayload: Record<string, unknown>;
  meta: SyncPackMeta;
  existingById: Map<string, Record<string, unknown>>;
}): SyncPackWritePlan {
  const { invChunks, trashChunks, corePayload, meta, existingById } = args;
  const contentSets: SyncPackSetOp[] = [];
  const skippedIds: string[] = [];

  const consider = (id: string, data: Record<string, unknown>) => {
    const prev = existingById.get(id);
    if (prev !== undefined && shardBodiesJsonEqual(prev, data)) {
      skippedIds.push(id);
      return;
    }
    contentSets.push({ id, data });
  };

  consider('core', corePayload);
  for (let i = 0; i < invChunks.length; i++) {
    consider(`i${i}`, { items: invChunks[i] });
  }
  for (let i = 0; i < trashChunks.length; i++) {
    consider(`t${i}`, { items: trashChunks[i] });
  }

  const deleteIds: string[] = [];
  for (const id of existingById.keys()) {
    if (id === 'meta' || id === 'core') continue;
    const im = /^i(\d+)$/.exec(id);
    if (im && parseInt(im[1], 10) >= invChunks.length) deleteIds.push(id);
    const tm = /^t(\d+)$/.exec(id);
    if (tm && parseInt(tm[1], 10) >= trashChunks.length) deleteIds.push(id);
  }

  const setOps: SyncPackSetOp[] = [];
  let metaWritten = false;
  if (contentSets.length > 0 || deleteIds.length > 0) {
    setOps.push({ id: 'meta', data: { ...meta } });
    setOps.push(...contentSets);
    metaWritten = true;
  } else {
    skippedIds.push('meta');
  }

  return {
    setOps,
    deleteIds,
    skippedIds,
    metaWritten,
    contentWrites: contentSets.length,
  };
}
