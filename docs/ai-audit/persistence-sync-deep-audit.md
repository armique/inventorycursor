# Persistence & Sync Deep Audit

**Date:** 2026-08-22  
**Method:** Static tracing of the live implementation. No application code was modified.  
**Out of scope:** Search performance (already shipped; see `docs/ai-audit/search-performance-results.md`).

**Measured payload (this machine, live `localStorage`):** `inventory_items` = **1,532,353 characters**, **1,998 items**, **162 containers**. That is ~1.46 MiB and ~767 characters per item on average. That average is consistent with **HTTPS photo URLs**, not embedded 380 k-character data URLs. Where a number is not measured, it is labeled **not measured**.

---

# Executive Summary

Inventory is a **single in-memory array** owned by `App` (`useState<InventoryItem[]>`). There is no per-item store and no traditional database. Persistence is **snapshot-based**:

1. **React:** `handleUpdate` copies the whole items array, replaces the edited row, then runs membership / container sync over the full list.
2. **localStorage:** after **400 ms** quiet, the **entire** inventory (and trash, expenses, settings, history, bulk imports) is `JSON.stringify`’d and written under `inventory_items` (plus sibling keys). Writes are deferred with `requestIdleCallback` (3 s timeout) and yielded between keys.
3. **Firestore:** after **200 ms** quiet (0 ms for sell/compose/delete), `writeToCloud` walks **every** item, trims large fields, **re-shards the whole pack**, and `set`s **every** `syncPack` document (`meta`, `core`, `i0…`, `t0…`). There is **no dirty-item or dirty-shard diff**.
4. **IndexedDB** is **not** used for inventory rows. It holds the Hub archive, product-card image blobs, optional local photo-folder handles, and Firestore’s own persistent cache.

**Most important confirmed bottlenecks (ranked):**

1. **Every cloud write rebuilds and overwrites the full sharded pack**, with **repeated `JSON.stringify` (via `new Blob`) per item while packing shards** — quadratic stringify work on the main thread after the debounce.
2. **Every local persist stringifies the entire 1.5 MiB inventory**, then **parses that same string again** to rebuild a derived sales pool.
3. **`handleUpdate` always copies the items array and always runs full-list membership enforcement** (which internally clones every row, then discards the clones if nothing changed).
4. **`App` + `PanelLayout` + active page + `GlobalSearch` + closed `SettingsModalHost` all re-render** because `items` identity changes.
5. **Base64 photos are a conditional amplifier**, not the default on this signed-in dataset. Signed-out / unarchived chat screenshots still embed `data:` URLs in the items JSON and then get stripped to `[omitted for size]` on the way to Firestore — so they bloat **local** persist far more than **cloud** payloads.

Debounce and in-flight coalescing **do exist** and work. The waste is **full snapshots**, not a queue of overlapping unsynced writes.

---

# Single Edit Lifecycle

Example: user double-clicks **Buy price** on one row, types a number, blurs. Confirmed path:

### 1. Event handler (urgent, main thread)

`components/InventoryList.tsx` → `saveEdit` (~3076–3119)

- Looks up the row with `items.find`.
- Builds `{ ...item, ...updates }` (spreads **that one item**, including `imageUrl` / `imageUrls` references).
- Calls `onUpdate([{ ...item, ...updates }])` with **no** `flushCloud`, **no** skip flags.

`onUpdate` is `App.handleUpdate`.

### 2. `handleUpdate` (`App.tsx` ~1875–2047)

Runs **synchronously on blur**:

| Step | What actually happens | Whole dataset? |
| --- | --- | --- |
| Fast-flush check | Linear `itemsRef.current.find` per updated id. Buy-price edit does **not** set `flushCloud` / status transition → default **200 ms** cloud debounce. | Scan of N for the one id |
| `setItems(currentItems => { … })` | `nextItems = [...currentItems]` — **new array, same object refs** except the edited slot. | Yes, array copy |
| Merge | `appendPriceHistoryIfChanged`, `applyPreservedFields` (copies missing fields from old row, including images), `recomputeRealizedProfit`. | One item |
| Parent clone | If the row has `parentContainerId`, `{ ...parent }` so memoized bundle rows refresh. Standalone edit: skipped. | Only parents of the edited id |
| `enforceContainerMembershipInvariants(nextItems)` | **Always** (unless `skipMembershipSync`). Internally `items.map(i => ({ ...normalized }))` — **clones all N items**, builds Maps, may `items.find` per container. If `changed === false`, the clones are **discarded** and the previous array is kept. | **Yes, every edit** |
| Empty-shell scan | `findEmptyContainerShellIds(nextItems)` | Full list |
| `syncContainerBuyTotalsFromComponents(nextItems, [id])` | Returns original array if the id does not touch a container. | Early-out possible |
| `syncContainerSaleMetaToChildren(nextItems, [id])` | No-op unless the touched id is a sold PC/bundle. | Early-out possible |
| Undo | `pushUndoSnapshot` stores **array references** (not a deep clone) in up to 30 snapshots; `setHistory` + `setHistoryIndex`. | Extra App state updates |
| Action log | `setActionHistory` — entries are `{ id, timestamp, action, itemId, itemName, details }` (**not** the full item). | Small |
| Flag | `hasUnsavedChanges.current = true` | — |

Then React commits: `items` identity changed.

### 3. Who re-renders (confirmed props)

`App.tsx` ~2605–2666:

- `PanelLayout` always receives `items={items}`.
- `SettingsModalHost` always receives `items={items}` (returns `null` when closed; **still re-renders**).
- Active route (`InventoryList` / `Dashboard` / …) receives `items`.
- `GlobalSearch` is under `PanelLayout` with the same array.

Unchanged item **object** refs are preserved, so `InventoryTableRow` `React.memo` can skip rows whose `item` ref is unchanged. The **parent** `InventoryList` still re-executes (filter memos, lookup rebuild on `items`, etc.). Lookup rebuild is **O(N)** and only when `items` identity changes — expected after an edit, not after a search keystroke.

### 4. Persistence effect (`App.tsx` ~1647–1704)

Fires because `items` is in the dependency list.

**Local (always when `appState === 'READY'`):**

- Clears previous `localPersistDebounceRef`.
- After **`LOCAL_PERSIST_DEBOUNCE_MS` (400)** (`utils/cloudSyncTiming.ts:14`):
  - `getSyncSnapshot()` reads refs (current items/trash/…).
  - `scheduleBackgroundWork` → `requestIdleCallback(..., { timeout: 3000 })`.
  - Inside the idle callback: **`JSON.stringify(snap.items)`** (full 1.5 MiB) plus stringify of trash, expenses, settings, categories, fields, recurring, **action history**, **bulk imports**.
  - `persistSnapshotToLocalStorage` (`services/backgroundPersistence.ts:34–64`):
    1. `yieldToMain()` (idle, 120 ms timeout)
    2. `localStorage.setItem('inventory_items', snapshot.itemsJson)` — **full blob**
    3. **`JSON.parse(snapshot.itemsJson)`** then `scheduleItemSalesPoolRebuild(items)`
    4. Yield + write trash / expenses / settings / categories / …

**Cloud (if signed in, hydrated, `hasUnsavedChanges`):**

- Clears previous `writeDebounceRef` ( **pending sync is replaced**, not stacked ).
- After **200 ms** (`WRITE_DEBOUNCE_MS`): `runSilentCloudSync`.
- If a write is already in flight: set `pendingCloudFlushRef = true` and **run once more** when the current write finishes (`App.tsx` ~1575–1578, 1614–1620). **At most one queued follow-up.**

### 5. `runSilentCloudSync` → `writeToCloud`

`App.tsx` ~1568–1620` → `services/firebaseService.ts` `writeToCloud` (~1418) → `writeShardedSyncPack` (~1231).

Payload is the **entire** snapshot: `inventory`, `trash`, `expenses`, `recurringExpenses`, `categories`, `categoryFields`, `settings`, `goals`, `dashboard`, `actionHistory`, `bulkImports`, `threeDPrint`.

Then, on the main thread (with yields):

1. `chunkItemsForFirestore(inventory)` — **every item**
2. `chunkItemsForFirestore(trash)` — **every trash row**
3. `shrinkCoreUntilUnder(buildCorePayloadForShard(data))` — stringify-loop until under 680 KiB
4. `getDocs(syncPack)` — read existing shards (quota + RTT)
5. `writeBatch` **`set` of `meta`, `core`, every `iN`, every `tN`**, delete leftover shards and legacy doc

**No comparison to previous shard contents.** Unchanged items are re-trimmed and re-written.

After success: `hasUnsavedChanges = false`; echo suppression 400 ms; idle `writeStoreCatalog` (store-visible subset).

### 6. Derived indexes

`scheduleItemSalesPoolRebuild` (`utils/itemSalesPool.ts:302–313`): 2.5 s debounce; skipped if a cheap sold-set token matches. Rebuild walks sold rows and **`JSON.stringify`s the events array** into `item_sales_pool_v1`. Triggered from the **parsed copy** of `inventory_items` after local persist — not from the in-memory array already in React.

---

# Top Bottlenecks

Ranked by **impact × frequency × user-visible effect**.

### 1. Full Firestore pack rewrite + per-item `JSON.stringify`/`Blob` while sharding

- **Where:** `services/firebaseService.ts` — `writeToCloud` (~1418), `writeShardedSyncPack` (~1231), `chunkItemsForFirestore` (~1065), `jsonByteSize` (~1060).
- **Root cause:** Snapshot sync. `jsonByteSize` does `new Blob([JSON.stringify(obj)]).size`. For **each** of N items it stringifies the singleton `{ items: [item] }`, then **`wrapSize([...current, item])` stringifies the growing shard** until 680 KiB. That is **Θ(items × shard-fill) stringify**, not one stringify. Then every shard document is `set` regardless of change.
- **Frequency:** Once per 200 ms quiet period of edits (coalesced). Also on tab hide / unload if dirty.
- **Data size:** Inventory ~1.46 MiB JSON locally; cloud items have `data:` / long strings replaced by `[omitted for size]` (`trimItemForSize`, ~991–1008) so **cloud bytes are smaller than local** when photos are Storage URLs (typical here) and **much smaller than local** when photos are data URLs.
- **Main-thread:** Yes, after debounce, with `yieldToMain` every 18 items (`YIELD_EVERY = 18`). Can still hitch during a burst of Blob+stringify.
- **Severity:** High (quota + CPU + multi-device echo of full pack).
- **Priority:** 1
- **If fixed:** Firestore writes drop from “all shards every edit” to “changed shards only”; packing CPU drops from quadratic stringify to one pass / running byte count. Expected: far fewer writes, shorter “syncing” status, less echo `onSnapshot` apply.

### 2. Full localStorage inventory stringify + immediate parse

- **Where:** `App.tsx` ~1657–1673; `services/backgroundPersistence.ts` `persistSnapshotToLocalStorage` (~34–42).
- **Root cause:** Snapshot persist. `JSON.stringify(snap.items)` then `JSON.parse(snapshot.itemsJson)` solely to call `scheduleItemSalesPoolRebuild`. The in-memory `snap.items` is already that array.
- **Frequency:** Once per 400 ms quiet period of any `items`/`trash`/… change.
- **Data size:** **Measured 1,532,353 chars** for `inventory_items` (1,998 rows).
- **Main-thread:** Stringify runs inside `requestIdleCallback` (timeout **3000 ms**), so it **can still run during interaction** if the main thread is busy. `setItem` of a 1.5 MiB string is a known browser hitch.
- **Severity:** High for persist hitch; the extra parse is pure waste (same CPU class as stringify).
- **Priority:** 1
- **If fixed:** ~50% of persist CPU removed by dropping the parse; idle stringify of 1.5 MiB remains unless persist becomes incremental.

### 3. `handleUpdate` array copy + full membership pass on every field save

- **Where:** `App.tsx` `handleUpdate` (~1904–2046); `utils/containerMembershipInvariants.ts` `enforceContainerMembershipInvariants` (~50–181).
- **Root cause:** Membership always runs. The helper **spreads every item** (`return { ...normalized }`) even when the result is thrown away (`if (!changed) return { nextItems: items, … }`). Also `items.find` per container when checking empty shells (~145).
- **Frequency:** Every `onUpdate` (inline cell edit, flags, photos, …).
- **Data size:** N = 1,998 object spreads discarded on a no-op membership check. **Not measured** in ms; expected small (low-single-digit ms) but **on the click/blur path**.
- **Main-thread:** Yes, before paint of the new value.
- **Severity:** Medium (visible if stacked with App re-render of the 8.8 k-line list).
- **Priority:** 2
- **If fixed:** Skip the clone-all when a cheap fingerprint says membership cannot change (e.g. update is a scalar field on a non-container). Edit-to-paint gets cheaper; no behavior change if the skip is conservative.

### 4. App-shell re-render from `items` identity

- **Where:** `App.tsx` `setItems` + `setHistory` / `setHistoryIndex` / `setActionHistory`; render ~2605–2666.
- **Root cause:** One array at the top; undo/history are React state, not refs.
- **Frequency:** Every successful edit.
- **Data size:** N/A (render, not bytes).
- **Main-thread:** Full `App` + layout + inventory list function body. Row memo still helps **cells**.
- **Severity:** Medium (same family as the search sprint’s parent-cost leftover).
- **Priority:** 2
- **If fixed:** Stop putting undo stacks in `useState` (keep refs); don’t pass `items` into `SettingsModalHost` when closed. Lower commit cost without a store rewrite.

### 5. Duplicate stringify of action history and bulk imports

- **Where:** Main persist effect `App.tsx` ~1671–1672 **and** dedicated effects ~1728–1749 (1.2 s debounce).
- **Root cause:** Comment at 1728 says history is persisted separately “so item edits don't always stringify it with inventory” — but the main persist **still includes** `actionHistoryJson` and `bulkImportsJson`.
- **Frequency:** Every local persist (400 ms) **plus** 1.2 s after history/bulk changes.
- **Data size:** History capped at **400** small entries (`ACTION_HISTORY_LIMIT`); bulk imports capped at 200. Smaller than inventory, but doubled work.
- **Main-thread:** Idle-callback stringify.
- **Severity:** Low–Medium.
- **Priority:** 3
- **If fixed:** One writer per key; item edits skip rewriting unchanged history.

### 6. Store-catalog rewrite after ordinary edits

- **Where:** `App.tsx` ~1452–1467; `writeStoreCatalog` `firebaseService.ts` ~1490.
- **Root cause:** Effect depends on `items`; if `hasUnsavedChanges`, after **1500 ms** rebuilds the public catalog from **all** items and `setDoc`s one document.
- **Frequency:** Coalesced 1.5 s after edits (and again after cloud sync success ~1606–1608 — **second catalog write**).
- **Data size:** Store-visible subset only (not measured).
- **Main-thread:** Catalog build is a full items scan; network is async.
- **Severity:** Low–Medium (extra Firestore write; duplicate with post-sync publish).
- **Priority:** 3
- **If fixed:** Publish once; skip if no `storeVisible` row changed.

### 7. Embedded `data:` images in local JSON (conditional)

- **Where:** `services/inventoryImageStorage.ts` `blobToPersistedUrl` (~452–459); `utils/imageCompress.ts` `INVENTORY_PHOTO_LOCAL_OPTIONS` (`maxEncodedChars: 380_000`); item fields `imageUrl`, `imageUrls`, `kleinanzeigenChatImage`, `kleinanzeigenBuyChatImage`, `ebayOrderScreenshotUrl`, `receiptUrl` (`types.ts` ~350–365); trim list `LARGE_ITEM_FIELDS` / `LARGE_ITEM_STRING_ARRAYS` (`firebaseService.ts` ~945–954).
- **Root cause:** Signed-out persist writes compressed JPEG **data URLs into the item**. Chat/receipt screenshots can still be raw `FileReader.readAsDataURL` in some modals before archive. Cloud sync **strips** `data:` strings (`shouldOmitString` / `shouldOmitImageFieldValue`) so Firestore does not store them — **localStorage still does**.
- **Frequency:** Every persist while those strings remain on items.
- **Data size:** This user’s live inventory is **~1.46 MiB / 1998 items (~767 B/item)** — **does not look like widespread 380 kB embeds**. One such photo would be ~25% of the 5 MB typical localStorage quota. **Not measured:** count of `data:` prefixes in the live blob (would require a read of `inventory_items`).
- **Main-thread:** Stringify/parse cost scales with those strings.
- **Severity:** **Low on this signed-in dataset**; **High if signed out or chat proofs stay as data URLs**.
- **Priority:** 4 unless a scan shows many `data:` URLs.
- **If fixed:** IDB blobs + reference keys. Benefit does **not** justify a migration **until** a scan shows embeds dominating `inventory_items`. Prefer archiving remaining data URLs to Storage (code already does this when signed in).

---

# Redundant Work

Confirmed in code (not guessed):

| Work | Evidence | Needed? |
| --- | --- | --- |
| `JSON.parse` of the string just produced by `JSON.stringify(snap.items)` | `backgroundPersistence.ts:36–39` | **No** — pass `snap.items` into `scheduleItemSalesPoolRebuild` |
| Stringify action history + bulk imports in the 400 ms persist **and** again in 1.2 s effects | `App.tsx:1671–1672` vs `1728–1749` | **No** — one owner per key |
| `enforceContainerMembershipInvariants` clones all N items then discards them when `changed === false` | `containerMembershipInvariants.ts:56–60, 178–179` | Clone is **unnecessary** on the no-op path |
| `wrapSize([...current, item])` re-stringifies the whole growing shard on **every** item | `firebaseService.ts:1069, 1088` | **No** — keep a running size |
| `jsonByteSize` uses `new Blob([JSON.stringify(obj)]).size` instead of `TextEncoder` | `firebaseService.ts:1060–1061` | Blob construction is extra work for a length |
| Full `b.set` of every `iN` / `tN` / `core` / `meta` even if bytes unchanged | `writeShardedSyncPack` ~1275–1289 | **No** — compare hashes to last write |
| `writeStoreCatalog` from the 1.5 s items effect **and** again after `writeToCloud` | `App.tsx:1452–1467` and `1606–1608` | Overlapping |
| `saveToLocalStorage` (sync, no idle) still used by migrations / restore / wipe | `App.tsx:720–757` | Fine for rare paths; **not** the edit path |
| Undo snapshots | `makeUndoSnapshot` stores **array refs**, shared item objects | **Not redundant** — this is cheap; do not “fix” it by deep-cloning |

**Not confirmed as redundant:** debounce timers (they coalesce). In-flight cloud writes (one follow-up flag). Sales-pool rebuild when the sold-set token matches (it returns early).

---

# Base64 Image Analysis

**Where they can live**

| Field | Typical content when signed in | Fallback when signed out / not archived |
| --- | --- | --- |
| `imageUrl`, `imageUrls` | Firebase Storage HTTPS (`blobToPersistedUrl` → `uploadJpegWithOptionalThumb`) | JPEG data URL, capped ~380 k chars (`INVENTORY_PHOTO_LOCAL_OPTIONS`) |
| `storeGalleryUrls` | Same | Same |
| `kleinanzeigenChatImage`, `kleinanzeigenBuyChatImage`, `ebayOrderScreenshotUrl`, `receiptUrl` | Storage URL after save | Often `data:` until archived |

**Duplication:** Thumbs are a **separate** map `inventory_photo_thumbs_v1` (`utils/photoThumbCache.ts`, max 2,000 entries) — original URL → thumb URL. Product-card images use **IndexedDB** (`dein_product_card_gallery_idb`) and are **not** in `inventory_items`.

**Serialized with inventory?** Yes, whatever string is on the item is in `JSON.stringify(snap.items)`. Cloud path **replaces** `data:` and long non-Storage strings with `CLOUD_OMITTED_PLACEHOLDER` (`"[omitted for size]"`). So:

- **localStorage / undo / daily backup JSON** can contain embeds.
- **Firestore inventory shards** generally do **not** (placeholder instead). Other devices then **lose** those photos on pull unless they already have them locally — a correctness issue, not just perf.

**Impact on this dataset:** Average ~767 chars/item in a 1.46 MiB blob ⇒ **images are not the dominant persist cost right now**. Do **not** start an IndexedDB photo migration as the first persist fix. Do **scan** `inventory_items` for `data:image` count before any migration (not done in this audit).

**When migration would be justified:** signed-out sessions, or a scan showing even a handful of 380 k-char strings (quota errors already handled for Hub archive). Until then, the Storage upload path already in `inventoryImageStorage.ts` is the right design.

---

# Storage Analysis

### localStorage (inventory path)

| Key | Written on single field edit? | How |
| --- | --- | --- |
| `inventory_items` | Yes, 400 ms + idle | Full array JSON |
| `inventory_trash` | Yes (same snapshot) | Full trash JSON even if unchanged |
| `inventory_expenses`, `business_settings`, `custom_categories`, `custom_category_fields`, `recurring_expenses`, dashboard prefs | Yes (same snapshot) | Unchanged siblings rewritten |
| `action_history` | Yes (in snapshot) + 1.2 s effect | Capped 400 |
| `bulk_imports` | Yes (in snapshot) + 1.2 s effect | Capped 200 |
| `item_sales_pool_v1` | Maybe, 2.5 s later | Derived events JSON |
| `inventory_photo_thumbs_v1` | No (only on new thumb remember) | — |

**Boot:** `loadLocalData()` (`App.tsx` ~1019) **synchronously** `JSON.parse`s inventory, trash, expenses, recurring **before** `READY`. That parse of 1.46 MiB is a **one-time** main-thread cost at startup (not per edit).

**Write frequency:** Coalesced 400 ms after the last state change in the persist effect’s dependency list. Rapid cell edits produce **one** stringify, not one per keystroke of the cell editor (the editor is local `editValue` until blur). **Inline typing inside a cell does not persist until `saveEdit`.** Confirmed: `saveEdit` runs on blur/Enter, not per character of `editValue`.

### IndexedDB

| Store | Role vs inventory rows |
| --- | --- |
| `inventory-pro-hub-archive` | eBay Hub fee ledger — **not** items |
| `dein_product_card_gallery_idb` | Generated card JPEGs — **not** items |
| `localPhotoFolder` DB | Directory handles — **not** items |
| Firestore `persistentLocalCache` | SDK replica of `syncPack` — extra copy of **cloud-trimmed** shards |

**Inventory rows are not in IndexedDB.**

### Serialization / parsing

| Operation | When | Blocks UI? |
| --- | --- | --- |
| `JSON.stringify(items)` | 400 ms + idle after edit | Can (idle timeout 3 s) |
| `JSON.parse(itemsJson)` | Immediately after that stringify | Same idle turn |
| Boot `JSON.parse(inventory_items)` | Once | Yes, before first paint |
| Cloud `jsonByteSize` / `wrapSize` | 200 ms after edit | Yes, yielded every 18 items |
| Daily backup `JSON.stringify` + gzip | Once/day, 8 s after boot | Idle callback (`App.tsx:1410–1437`) |

### Payload sizes (measured vs not)

| Payload | Size | Source |
| --- | --- | --- |
| `inventory_items` | **1,532,353 chars** | Live `localStorage` (earlier CDP session, same 1,998 / 162 dataset) |
| Firestore shard | ≤ **680 KiB** JSON body (`CHUNK_BODY_MAX`) | Code constant; live shard count **not measured** |
| Daily backup | gzip of full snapshot | Logged as KB at runtime; **not measured here** |

---

# Firestore Synchronization Analysis

### Triggers

| Trigger | Delay | Source |
| --- | --- | --- |
| Any persist-effect dependency change while dirty | `WRITE_DEBOUNCE_MS` **200** | `App.tsx:1682–1699` |
| Sell / compose / delete / `flushCloud` / new PC/bundle | `FAST_CLOUD_FLUSH_MS` **0** (next timer tick) | `shouldFlushCloudSoon` + `requestFastCloudFlush` |
| Tab hidden / `beforeunload` | Immediate `runSilentCloudSync` | `App.tsx:1706–1726` |
| Remote apply left local-only rows | Fast flush | `App.tsx:1625–1637` |
| Force push (Settings) | Immediate, `allowEmptyOverwrite` | `handleForcePush` |

### Queueing / debounce (confirmed correct coalescing)

- New edits **clear** `writeDebounceRef` and start a new 200 ms timer → **latest snapshot wins**.
- If `cloudSyncInFlightRef`: do not start a second write; set `pendingCloudFlushRef` and run **one** more write in `finally`.
- Echo: `REMOTE_APPLY_SUPPRESS_MS` 400 + `shouldAcceptRemoteSnapshot` (`utils/cloudSyncTiming.ts:59–87`). Own write’s `onSnapshot` is usually ignored.

**200 ms is not “unnecessary churn” by itself.** Churn is **what** is sent (full pack), not how often the timer fires.

### Payload

Full `FirestoreInventoryPayload`. Items are `sanitizeForFirestore` + `trimItemForSize` + optional `deepTrimLargeStrings`. Storage download URLs are **kept**. `data:` and long strings become `[omitted for size]`.

### Incremental opportunity

**High.** Last written shard hashes are not stored. `writeShardedSyncPack` always `set`s `i0…iK`. A per-shard SHA (or even string equality of JSON) against the last successful write would skip unchanged documents. Item-level sync (one doc per item) would be a **Phase 3** model change and fights the current 1 MiB sharding design; **shard-level skip is the targeted fix**.

### Reads

`getDocs(colRef)` on **every** write to know which extra `iN` to delete. Necessary for shrinking packs; could cache last chunk counts in memory after the first write.

### `onSnapshot`

`subscribeToData` listens to the whole `syncPack` collection. A self-write that rewrites all shards **wakes the listener with every document**. Echo suppression avoids applying it, but the SDK still delivers the snapshot (and `recordFirestoreReads(snap.size)`). Full-pack writes therefore cost **writes + reads** on the same device.

---

# Recommended Solutions

Prefer targeted patches. Do **not** replace React state with a new store as the first move.

### R1 — Stop parse-after-stringify of inventory

- **Problem:** `persistSnapshotToLocalStorage` parses `itemsJson` only to rebuild the sales pool.
- **Solution:** Pass `InventoryItem[]` through `LocalPersistSnapshot` (or call `scheduleItemSalesPoolRebuild(snap.items)` from `App` before persist).
- **Minimal approach:** Add optional `items?: InventoryItem[]` to the snapshot type; parse only if missing.
- **Benefit:** Removes one full 1.46 MiB `JSON.parse` per persist.
- **Complexity:** Low · **Risk:** Low · **Dependencies:** None.

### R2 — Incremental shard writes (hash skip)

- **Problem:** Unchanged `iN`/`tN`/`core` rewritten every sync.
- **Solution:** Keep `lastShardHash` in a module-level Map (and optionally localStorage). After packing, `set` only shards whose hash changed; always bump `meta.updatedAt` if anything changed.
- **Minimal approach:** `fnv1a`/`cyrb53` on the JSON string of each `{ items }` body.
- **Benefit:** Writes/edit → typically 1–2 docs instead of all shards; weaker echo; lower quota.
- **Complexity:** Medium · **Risk:** Medium (must never skip a real change; test with `verify-cloud-sync-*.ts`) · **Dependencies:** None.

### R3 — Running byte size instead of re-stringify

- **Problem:** `wrapSize` / `jsonByteSize` stringify the growing chunk every item.
- **Solution:** `TextEncoder.encode(JSON.stringify(item)).length` once per item; add to a running total with JSON array overhead (`2 + commas`). Recalculate only on trim retries.
- **Benefit:** Packing CPU from quadratic to linear.
- **Complexity:** Low–Medium · **Risk:** Low if a unit test compares against `Blob` size for a fixture shard · **Dependencies:** None. Do before or with R2.

### R4 — Don’t clone all items in membership no-op

- **Problem:** `enforceContainerMembershipInvariants` spreads every row then throws the array away.
- **Solution:** Build Maps from the **existing** objects; only `{ ...item }` when a patch applies. Optional fast-path: if every updated id is a non-container scalar field, skip membership entirely (`handleUpdate` already has `skipMembershipSync` for some callers).
- **Benefit:** Less work on the blur path.
- **Complexity:** Low · **Risk:** Medium if the skip is too aggressive (stale `componentIds`). Safer: remove the unconditional spread first.
- **Dependencies:** Existing membership tests / `verify-critical-flows.ts`.

### R5 — Single writer per localStorage key

- **Problem:** History and bulk imports stringify twice.
- **Solution:** Remove those two keys from the 400 ms inventory snapshot; keep the 1.2 s effects (or vice versa).
- **Benefit:** Small CPU; clearer ownership.
- **Complexity:** Low · **Risk:** Low · **Dependencies:** None.

### R6 — Undo / settings-host re-render trim

- **Problem:** `setHistory` + `setHistoryIndex` + closed settings host re-render on every edit.
- **Solution:** Keep undo stacks in refs + a version counter only when the UI needs it; render `SettingsModalHost` only when open (or pass `items` only then).
- **Benefit:** Smaller React commit on edit.
- **Complexity:** Medium · **Risk:** Low–Medium (undo UI must still read refs) · **Dependencies:** None.

### R7 — One store-catalog publish

- **Problem:** Catalog written 1.5 s after edit and again after cloud sync.
- **Solution:** Only publish from one place; skip if no storefront-relevant field changed.
- **Benefit:** Fewer Firestore writes.
- **Complexity:** Low · **Risk:** Low · **Dependencies:** None.

### R8 — Data-URL scan, then archive (not a new IDB design)

- **Problem:** Possible leftover `data:` on chat/receipt fields.
- **Solution:** Count `data:image` in `inventory_items`. If count is 0, stop. If > 0, run the existing `persistInventoryImages` / bulk archive path.
- **Benefit:** Shrinks local JSON using **current** Storage code.
- **Complexity:** Low · **Risk:** Low · **Dependencies:** Signed-in Storage.
- **Do not** build a parallel IndexedDB inventory-photo system unless the scan shows quota-level embeds **and** the user often works signed out.

### R9 — (Later) Per-item cloud docs

- **Problem:** Full-pack model.
- **Solution:** Only if R2 is insufficient (still hitting quota or 1 s+ packing).
- **Complexity:** High · **Risk:** High · **Dependencies:** R2 first; migration of `syncPack`.

---

# Prioritized Implementation Plan

## Phase 1 — Quick wins

| Order | Task | Priority | Impact | Complexity | Risk | Dependencies |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | R1 Drop persist `JSON.parse` round-trip | P1 | High CPU per persist, tiny risk | Low | Low | None |
| 2 | R3 Linear shard packing (running size / no Blob) | P1 | High CPU per cloud write | Low–Med | Low | Fixture size test |
| 3 | R5 One localStorage writer for history/bulk | P3 | Small | Low | Low | None |
| 4 | R7 Dedupe store-catalog publish | P3 | Small quota | Low | Low | None |
| 5 | R8 Scan `data:image`; archive if any | P4 | Unblocks quota only if embeds exist | Low | Low | Auth + Storage |

## Phase 2 — Medium-term

| Order | Task | Priority | Impact | Complexity | Risk | Dependencies |
| --- | --- | --- | --- | --- | --- | --- |
| 6 | R2 Skip unchanged shards | P1 | High quota + echo | Medium | Medium | R3 helpful first; cloud-sync verify scripts |
| 7 | R4 Membership without clone-all | P2 | Edit-to-paint | Low | Medium | Membership tests |
| 8 | R6 Undo refs + don’t drill `items` into closed settings | P2 | Render cost | Medium | Low–Med | None |

## Phase 3 — Architectural (only if Phase 1–2 are not enough)

| Order | Task | Priority | Impact | Complexity | Risk | Dependencies |
| --- | --- | --- | --- | --- | --- | --- |
| 9 | Incremental local persist (dirty keys / dirty items) | P2 | Persist hitch | Medium | Medium | R1 |
| 10 | Inventory context/selectors or a small store | P2 | Render isolation | High | Medium | After R6 so the win is measurable |
| 11 | R9 Per-item Firestore docs | P3 | Sync model | High | High | R2 proven insufficient |
| 12 | IndexedDB blobs for unsigned-out photos | P4 | Only if scan + signed-out usage demand it | High | Medium | R8 |

**Recommended implementation order:** R1 → R3 → R2 → R4 → R6 → R5/R7 → R8. Stop after R2 and re-measure persist time and Firestore write counts before any Phase 3 work.

---

# Assumptions vs confirmed

| Claim | Status |
| --- | --- |
| Single edit copies the items array and replaces one object | **Confirmed** (`handleUpdate`) |
| Entire inventory is stringified to localStorage after debounce | **Confirmed** |
| That string is parsed again immediately | **Confirmed** |
| Cloud write sends the full inventory and `set`s all shards | **Confirmed** |
| Debounce replaces pending timers; in-flight writes queue one follow-up | **Confirmed** |
| `inventory_items` ≈ 1.53e6 chars / 1998 items | **Measured** (live localStorage) |
| Average item is ~767 chars ⇒ not data-URL-dominated | **Inferred** from that average |
| Count of `data:image` in the live blob | **Not measured** |
| Milliseconds for `handleUpdate` membership clone | **Not measured** (structure confirmed) |
| Exact Firestore shard count / write bytes per edit | **Not measured** (680 KiB cap confirmed) |
| Undo deep-clones inventory | **False** — stores array references |

No application code was changed. Waiting for approval before any persistence/sync implementation.
