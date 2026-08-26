# Edit Path Performance Sprint — Results (E1, E2, E3)

**Date:** 2026-08-22  
**Scope:** The save/edit path for **one inventory item**. Search, Firestore packing/skip-writes, image storage, and React state libraries were not changed.

Membership and empty-shell **results** are byte-identical to a frozen copy of the pre-sprint algorithms (`scripts/verify-edit-path.ts`).

---

# Baseline

Verified against the code **after** the persistence/sync sprint (R1/R3/R2), before this sprint.

## Single-field save (e.g. buy price blur)

1. `InventoryList.saveEdit` spreads that one item and calls `onUpdate([{ ...item, ...updates }])`.
2. `App.handleUpdate`:
   - Linear `items.find` per updated id (flush heuristic).
   - `setItems`: **copy the whole items array**, replace one slot, optional parent `{ ...parent }`.
   - **Always** `enforceContainerMembershipInvariants` (unless `skipMembershipSync`): internally `{ ...row }` for **every** row, `working.findIndex` on each patch, `items.find` per container, then **discard** the clones when `changed === false`.
   - **Always** `findEmptyContainerShellIds`: for each of ~162 containers, `items.some` over all 1,998 rows (O(containers × N)).
   - `syncContainerBuyTotalsFromComponents` / `syncContainerSaleMetaToChildren` (already early-out for unrelated ids).
   - `pushUndoSnapshot` → `setHistory` + `setHistoryIndex` **in addition to** `setItems`.
   - `setActionHistory` for the action log.
3. React: `App` re-renders (items + undo state + action log). `PanelLayout` receives new `items`. Closed `SettingsModalHost` still runs (returns `null`). `GlobalSearch` is already `React.memo`’d.

A new items array is **required** for React; this sprint does not try to avoid it.

---

# Changes Made

## E1 — Membership enforcement

**Files:** `utils/containerMembershipInvariants.ts`  
**Functions:** `enforceContainerMembershipInvariants`, `findEmptyContainerShellIds`

**Previous**

- Built `working` as `items.map(i => ({ ...normalize(i) }))` — N clones on every save, even a no-op.
- `touch` used `working.findIndex`.
- Container input snapshot used `items.find`.
- Iterated `[...working]` copies.
- `findEmptyContainerShellIds` was O(containers × N).

**New**

- Keep original object identity unless `normalizeExclusiveContainerFlags` or `touch` actually patches a row.
- `indexById` / `originalById` Maps instead of `find` / `findIndex`.
- Iterate `working` directly.
- Empty-shell scan is two O(N) passes (parent pointers + listed `componentIds`) with a `keepAlive` Set.

Healing rules are unchanged: invalid parents cleared, one owner per part, sold standalones not re-attached, `componentIds` rewritten in prior order, emptied sold/active shells deleted.

## E2 — `handleUpdate` path

**Files:** `App.tsx` (`handleUpdate`, undo stack), `services/containerAggregates.ts` (`updateTouchesContainers`)

**Previous**

- `find` / `findIndex` / `componentIds.includes` scans during the update.
- Parent refresh did `nextItems.map` cloning matching ids.
- Undo stack was **duplicated** in `useState` (`history`, `historyIndex`) and refs; every edit called `setHistory` + `setHistoryIndex` inside the `setItems` updater (extra App renders). Undo/redo already read the refs.

**New**

- One `Map` for current items (flush heuristic) and one `indexById` while merging updates.
- Parent refresh: `Set` of updated ids; in-place `{ ...row }` only for parents that need a new identity (no full `map`).
- Undo/redo/wipe/cloud-reset write **only** `historyRef` / `historyIndexRef`. `setItems` / `setTrash` still run so the UI and persist/sync effects fire. `appendUndoHistory` is unchanged.

## E3 — App-shell render isolation

**Files:** `components/PanelLayout.tsx`, `components/SettingsModalHost.tsx`  
(`GlobalSearch` was already `React.memo` — not changed.)

**Evidence (code, not a live React Profiler session):**

| Component | On a single item edit | Isolation |
| --- | --- | --- |
| `SettingsModalHost` | Received new `items` (and later `actionHistory`); when closed the body is `return null` — **confirmed cheap**, SettingsPage unmounted | Wrapped in `React.memo`. Still re-renders when `items` identity changes because that prop is new. Did **not** hide inventory props behind a store (would stale-open settings). |
| `PanelLayout` | Re-ran sidebar, `countOpenEbayOrderLines(items, orders)`, gamification hook, and (if expanded) `GlobalSearch` | `React.memo(PanelLayout)` so **action-history-only** App updates skip the shell. Open-eBay badge: skip `countOpenEbayOrderLines` when the `id:ebayOrderId` fingerprint is unchanged (typical buy-price edit). |
| `GlobalSearch` | Already memoized; skips if `items`/`expenses`/`businessSettings` refs match | Unchanged |
| `InventoryList` | Must re-render — it displays the edited row | Unchanged (correct) |

No blanket `memo` on unrelated trees. No Redux/Zustand.

---

# Before vs After

Dataset for Node benches: **1,998 items, 162 containers** (same shape as the live inventory blob). Times are Node `performance.now()`, **not** Chrome commit times.

| Metric | Before | After | Kind |
| --- | --- | --- | --- |
| Membership internal clones on a no-op save | **1998** object spreads | **0** | **measured** (algorithm; frozen vs live) |
| Membership + empty-shell pass | **2.33 ms** | **1.11 ms** (~2.1×) | **measured** (40-loop average, Node) |
| Empty-shell complexity | O(containers × N) ≈ 162 × 1998 | O(N) | **measured** (equivalence + structure) |
| `handleUpdate` items array copy | 1 new array | 1 new array | unchanged (required) |
| Extra `setHistory` / `setHistoryIndex` per edit | 2 | **0** | **code-confirmed** |
| `PanelLayout` on action-log-only App re-render | always | skipped if props equal | **code-confirmed** (`React.memo`) |
| `countOpenEbayOrderLines` on buy-price edit | every items identity change | skipped if ebay-link fingerprint unchanged | **code-confirmed** |
| Edit/save click-to-paint (browser) | — | — | **not measured** (no Profiler/CDP session this sprint) |
| React commit duration / which fibers | — | — | **not measured** (Profiler not recorded) |

When membership **does** change (compose, sell last part, heal), only patched rows get new object identity, so `InventoryTableRow` memo can skip unrelated rows. Previously every row was cloned internally even though a no-op returned the original array; a **changing** pass previously cloned everyone.

---

# Correctness Verification

| Check | Result |
| --- | --- |
| `npx tsx scripts/verify-edit-path.ts` | **passed** — frozen vs live membership JSON + `deleteIds` + `changed`; empty-shell id sets equal; no-op keeps array **and** row identity; heal keeps unrelated row identity; `appendUndoHistory` still stacks snapshots |
| Fixtures: consistent PC+child, invalid parent, heal from `componentIds`, sold standalone not attached, empty sold shell, dual `isPC`+`isBundle`, `componentIds` order | **identical** to frozen |
| `verify-heal-active-container-parts.ts` | **ok** |
| `verify-asus-a320m-pc-restore.ts` (includes undo helper) | **ok** |
| `verify-integral-ram-kit-restore.ts` | **ok** |
| `verify-persist-sync-sprint.ts` | **passed** (local persist + shard skip unchanged) |
| `verify-cloud-sync-timing.ts` | **passed** (200 ms / 0 ms flush helpers) |
| `verify-tsx-parse.ts` | **ok (172 files)** |

**Normal item editing:** merge/preserve/price-history/profit path in `handleUpdate` is the same; only lookup structures changed.

**Undo:** snapshots are still `{ items, trash }` array references via `appendUndoHistory`; Ctrl/toast undo still `setItems(snapshot.items)` + `setTrash`. Persist and cloud effects still depend on `items`.

**Firestore:** `handleUpdate` still sets `hasUnsavedChanges` and the existing 200 ms debounce / R2 skip-unchanged-shards path.

Live click-in-the-app session was **not** run; membership equivalence is the behavioral guarantee.

---

# Remaining Bottlenecks

Intentionally **not** addressed:

1. **Full `JSON.stringify` of inventory** to localStorage every 400 ms (persist sprint only removed the extra parse).
2. **`App` still re-renders on `setItems`** — required; list + dashboard still receive the new array.
3. **`SettingsModalHost` still re-renders on `items` identity** when closed (body is `null`; isolating props would need an items ref and would stale the open modal unless subscribed).
4. **`useGamificationEvents` still diffs the full list** on every items change (needed to detect live sales).
5. **Action log `setActionHistory`** still extra-renders `App` (PanelLayout can now skip; SettingsHost still sees `actionHistory`).
6. **Membership still walks the full list** on every save (no skip of heal-on-scalar-edit, to keep behavior exact).
7. **Search / InventoryList size / virtualization / photos / per-item Firestore docs** — other sprints.

Do not start another performance area until this sprint is accepted.

---

# How to re-run

```bash
npx tsx scripts/verify-edit-path.ts
```

or `npm run verify:edit-path`.
