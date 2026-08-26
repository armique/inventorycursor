# Persistence & Sync Sprint — Results (R1, R3, R2)

**Date:** 2026-08-22  
**Scope:** Only the three approved items from `docs/ai-audit/persistence-sync-deep-audit.md`:

- **R1** — Remove the persist `JSON.parse` round-trip used only to rebuild the sales pool  
- **R3** — Linear-time Firestore shard packing (no growing-chunk `JSON.stringify` / `Blob`)  
- **R2** — Skip Firestore `set` for shards whose JSON body is unchanged  

No search, membership, image-storage, IndexedDB, or React-state architecture changes.

---

# Changes Made

## R1 — Remove unnecessary persist parse

**Files**

- `services/backgroundPersistence.ts` — `LocalPersistSnapshot`, `itemsForSalesPool`, `persistSnapshotToLocalStorage`
- `App.tsx` — three `persistSnapshotToLocalStorage` call sites (remote apply, debounced local persist, force push)

**Why it was expensive**

After every debounced persist, the code already had `itemsJson = JSON.stringify(snap.items)` (full inventory, ~1.46 MiB on this machine). `persistSnapshotToLocalStorage` then immediately `JSON.parse(snapshot.itemsJson)` solely to call `scheduleItemSalesPoolRebuild`. That parse duplicated the stringify cost and allocated a second copy of every item.

**What changed**

- Snapshot type accepts optional `items?: InventoryItem[]`.
- When `items` is an array, the sales pool is scheduled from that in-memory list. `itemsJson` is still written to `inventory_items` unchanged.
- If `items` is omitted, the previous parse path remains as a fallback.

`scheduleItemSalesPoolRebuild` behavior is unchanged (token skip, 2.5 s debounce). Callers pass the same array that was just stringified.

## R3 — Linear Firestore shard packing

**Files**

- `utils/firestoreShardPack.ts` (new) — `utf8ByteLength`, `jsonUtf8ByteSize`, `packItemsIntoShards`, `wrappedItemsByteSize`
- `services/firebaseService.ts` — `chunkItemsForFirestore`, `jsonByteSize` (now UTF-8 length, not `Blob`)

**Why it was expensive**

`chunkItemsForFirestore` estimated size with `new Blob([JSON.stringify(obj)]).size`. For every item it also called `wrapSize([...current, item])`, which **re-stringified the entire growing shard**. That is Θ(items × shard-fill) stringify work on the main thread after the 200 ms cloud debounce.

**What changed**

- Each item is `JSON.stringify`’d **once** (again if a trim retry is needed).
- UTF-8 size uses `TextEncoder` (same as `Blob([s]).size` for a string).
- Shard capacity uses a running total: `{"items":[]}` wrapper + per-item JSON bytes + commas.
- `packItemsIntoShards` never stringifies the growing array.
- Document format is unchanged: `{ items: [...] }` docs, 680 KiB cap (`FIRESTORE_CHUNK_BODY_MAX`).

Equivalence: the verify script’s frozen copy of the old Blob/`wrapSize` loop produces **identical shard boundaries** on the 1,998-item fixture.

## R2 — Skip unchanged Firestore shards

**Files**

- `utils/firestoreShardPack.ts` — `planSyncPackWrites`, `shardBodiesJsonEqual`
- `services/firebaseService.ts` — `writeShardedSyncPack`

**Why it was expensive**

Every cloud flush `set` every `syncPack` document (`meta`, `core`, all `iN`, all `tN`) even when the packed JSON was identical. That burned write quota and woke `onSnapshot` with a full pack echo.

**What changed**

After packing, `writeShardedSyncPack` still `getDocs` the existing `syncPack` collection (same as before). `planSyncPackWrites` compares `JSON.stringify` of each new body to the existing document data:

- Equal `core` / `iN` / `tN` → skip that `set`
- Missing doc → `set` (covers first sync and partial prior writes)
- Leftover `iN`/`tN` beyond the new chunk count → `delete` (same as before)
- `meta` (new `updatedAt`) is written **only if** at least one content shard changed or a leftover shard is deleted
- If nothing in the pack changed, the function returns without `writeBatch` and without deleting the legacy doc

Comparison uses documents returned by `getDocs`, not an in-memory hash table, so it survives restart/reload (Firestore persistent cache or server).

Debounce / in-flight coalescing in `App` is unchanged: rapid edits still collapse to one `writeToCloud` of the latest snapshot; R2 then writes only the shards that differ from what is already in Firestore.

---

# Correctness Verification

| Check | Result |
| --- | --- |
| `npx tsx scripts/verify-persist-sync-sprint.ts` | **passed** |
| Frozen quadratic packer vs linear packer: shard count, per-shard lengths, item order | **identical** on 1,998 synthetic items |
| Each packed `{ items }` JSON ≤ 680 KiB | **asserted** |
| `wrappedItemsByteSize` vs `jsonUtf8ByteSize({ items })` for n = 0…24 | **equal** |
| `utf8ByteLength` vs `new Blob([s]).size` (unicode fixture) | **equal** |
| Unchanged pack → 0 writes, meta not bumped | **asserted** |
| Empty existing map → meta + core + all `iN` | **asserted** |
| One item changed → `meta` + that item’s shard only | **asserted** |
| Items in first and last shards changed → `meta` + those shards, `core` skipped | **asserted** |
| Shrinking chunk count → delete leftover `iN`, write meta | **asserted** |
| Missing `i0` with neighbors unchanged → rewrite `i0` + meta | **asserted** |
| Persist with `items` provided → `JSON.parse` count **0**; `inventory_items` equals `itemsJson` | **asserted** |
| Persist without `items` → parse fallback still runs | **asserted** |
| `npx tsx scripts/verify-cloud-sync-timing.ts` | **passed** (debounce helpers unchanged) |
| `npx tsx scripts/verify-tsx-parse.ts` | **ok (172 files)** |

**Not exercised against live Firestore in this sprint** (no signed-in write probe). Write counts below come from `planSyncPackWrites` on a JSON round-trip of packed shards, which is the same comparison `writeShardedSyncPack` performs on `getDocs` data.

**Coalescing / reload (logic, not a UI session)**

- Multiple rapid edits still hit one persist (400 ms) and one cloud flush (200 ms) of the latest `getSyncSnapshot()` — unchanged `App.tsx` timers.
- After that flush, a second flush of the same snapshot is a **0-document** plan (R2).
- Restart: skip decisions use existing Firestore docs, not process memory.

---

# Before vs After

## R1 — persist parse

| Metric | Before | After | Kind |
| --- | --- | --- | --- |
| `JSON.parse` of `itemsJson` per persist when `items` is passed | 1 | **0** | **measured** (Node, `JSON.parse` monkey-patch) |
| `inventory_items` value | full `itemsJson` string | same string | **measured** |
| `JSON.stringify(items)` to build `itemsJson` | still 1 per persist | still 1 | unchanged (out of R1 scope) |
| Time for 1.46 MiB `JSON.parse` on device | — | — | **not measured** (would need a browser persist probe) |

## R3 — packing (Node, 1,998 synthetic items, avg **408** JSON bytes/item, **2** shards)

Single run of `scripts/verify-persist-sync-sprint.ts` on this machine (Node, not the browser main thread):

| Metric | Frozen quadratic (pre-sprint) | Linear (this sprint) | Kind |
| --- | --- | --- | --- |
| `JSON.stringify` calls | **3995** | **1998** | **measured** |
| Wall time | **1489 ms** | **3.03 ms** | **measured** (one run) |
| Speedup | — | **~492×** | **measured** (1489 / 3.03) |
| Shard boundaries vs old packer | — | identical | **measured** |

**Limitations**

- Fixture items are smaller than live inventory (~408 B vs measured ~767 B/item in the audit). Live packing would use more/larger shards; relative stringify waste of the old `wrapSize` loop **grows** with shard fill, so production packing CPU was at least this bad.
- Times are Node `performance.now()`, not Chrome main-thread long tasks. Do not treat 1489 ms as a user-visible hitch number.
- `chunkItemsForFirestore` still yields every 18 items (`yieldToMain`); that delay is **not** included in the 3.03 ms packer-only bench.

`shrinkCoreUntilUnder` still stringifies the core payload in a bounded retry loop (≤ 40). That was never the quadratic item packer; Blob was replaced with `jsonUtf8ByteSize` only.

## R2 — Firestore documents written

See next section. Quota counters (`recordFirestoreWrites` / `Deletes`) now use the **actual** set/delete counts from the plan, not `2 + invChunks + trashChunks`.

---

# Firestore Write Comparison

Fixture after packing: **2** inventory shards (`i0`, `i1`), empty trash, plus `meta` and `core`.  
**Pre-sprint behavior (code):** every successful `writeShardedSyncPack` `set` meta + core + every `iN` + every `tN` and `delete` the legacy doc → **4 sets + 1 legacy delete** on this fixture, every time.

| Scenario | Documents `set` after R2 | Deletes | Kind |
| --- | --- | --- | --- |
| Unchanged inventory (same packed JSON as existing docs, e.g. repeat sync or reload then flush identical snapshot) | **0** | **0** (legacy delete skipped on complete no-op) | **measured** (`planSyncPackWrites`) |
| First write (no existing `syncPack` docs) | **4** (`meta`, `core`, `i0`, `i1`) | 0 extra `iN`; legacy delete still runs if any set occurs | **measured** |
| One item changed (row in `i0`) | **2** (`meta`, `i0`); `core` and `i1` skipped | 0 | **measured** |
| Multiple items changed (first row and last row, different shards) | **3** (`meta`, `i0`, `i1`) | 0 | **measured** |
| Inventory shrinks by one shard | meta written; leftover `iN` **deleted** | **1** | **measured** |

On live data (~1.53e6 chars) expect **~3** inventory shards rather than 2; a one-field edit still writes **meta + 1 shard** when only that shard’s JSON changes. Exact live shard count was **not measured** in this sprint.

A no-op no longer bumps `meta.updatedAt`, so other devices are not woken for identical content.

---

# Remaining Bottlenecks

Intentionally **not** addressed (still as in the deep audit):

1. **`handleUpdate` copies the whole items array** on every field save (`App.tsx`).
2. **`enforceContainerMembershipInvariants` clone-all** then discard when unchanged.
3. **App shell re-renders** (`PanelLayout`, active page, closed `SettingsModalHost`, `GlobalSearch`) because `items` identity changes; undo stacks are React state.
4. **Full `JSON.stringify` of inventory to localStorage** every 400 ms quiet period (R1 only removed the extra parse).
5. **Sibling localStorage keys** (trash, expenses, settings, …) rewritten even when unchanged; action history / bulk imports still stringified in the main snapshot **and** in dedicated effects.
6. **Store-catalog publish** still runs from the 1.5 s items effect and again after cloud sync.
7. **Base64 / `data:` photos** still live on items when signed out; not migrated.
8. **Per-item Firestore documents** not adopted; packing is still a full snapshot, then shard-level skip.

Do not start those until this sprint is accepted.

---

# How to re-run

```bash
npx tsx scripts/verify-persist-sync-sprint.ts
```

or `npm run verify:persist-sync`.
