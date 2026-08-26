# Search Performance Sprint — Results

**Date:** 2026-08-22
**Scope:** QW1 (deferred search value), QW2 (column-width memo invalidation), QW7 (O(N²) → O(N) lookups), QW6 (haystack cache + per-pass tokenizer).
**Constraint:** Search results must be identical to the pre-sprint behavior. No unrelated refactors.

This sprint was implemented against the live inventory list (`components/InventoryList.tsx`) and the shared helpers it calls. A full React Profiler *before* recording was not possible in a clean pre-sprint UI: the four changes were already in the working tree when the sprint was approved. Baseline numbers below therefore come from:

1. Frozen pre-sprint copies of the filter/search helpers (byte-identical to `HEAD` at commit `fd38394`).
2. A side-by-side Node bench of those copies vs the optimized path on a dataset shaped like production (1,998 items, 162 PC/bundle containers — same shape as the live `inventory_items` blob).
3. A behavior-equivalence suite (49,600 assertions) so result sets cannot silently drift.

A live CDP typing pass against `localhost:5174/panel/inventory` was attempted (N = 1,998). Chrome was in the background behind a Twitch tab and leftover PerformanceObservers stacked 3×, so those long-task numbers are **not** used as official after-metrics.

---

## Exact changes

### QW1 — Defer the search value

The search `<input>` stays bound to urgent `searchTerm` so the typed character paints immediately. Filtering, sorting, auto-width, suggestions-adjacent list work, purchases-inbox filtering, and bundle-reopen follow `deferredSearchTerm = useDeferredValue(searchTerm)`.

- Input `value={searchTerm}` / `onChange → setSearchTerm` unchanged (desktop + mobile).
- `listFilterParams.searchTerm` is now `deferredSearchTerm`.
- Preference persistence still uses urgent `searchTerm` (already 200 ms debounced).

### QW2 — Stop width churn from defeating `React.memo`

Per-keystroke auto-width recomputes produced new object identities even when the numbers were unchanged. `renderRowCells` depended on `effectiveColumnWidths`, so every memoized row re-rendered.

- `sameWidthRecord()` reuses the previous width object when values are identical.
- Applied to both `autoColumnWidths` and `effectiveColumnWidths`.
- Flags-column DOM measure (`querySelectorAll('[data-flags-strip]')`) no longer runs after every `InventoryList` render. It is keyed on `[items, listDensity]` — the same inputs that reset the measured width. Search keystrokes no longer force an extra layout + possible `setState` commit.
- `renderRowCells` still lists `effectiveColumnWidths` in its `useCallback` deps so a *real* width change (resize, new icon type, density toggle) still invalidates rows.

### QW7 — Eliminate O(N²) filtering

`getChildren` / `getParentContainer` / `itemMatchesActiveInventoryTab` / `shouldHideContainerChildInList` / `containerOrChildMatchesSearch` used `items.find` / `items.filter` / `componentIds.includes` **per item**. One Active-tab search pass was O(N²). Split view ran that 2–3 times.

- New `buildInventoryLookup(items)` builds `itemById`, `childrenByParentId`, `containerByComponentId` once per `items` identity.
- The helpers accept an optional `lookup` and do O(1) map gets. Callers that omit it keep the original scans (Dashboard, other screens — untouched).
- `InventoryList` builds the lookup in a `useMemo` on `items` and passes it through `listFilterParams`.
- Maps preserve first-match semantics of the original `Array.find` scans (verified).

### QW6 — Cache haystacks; tokenize once per pass

- `haystack(item)` is cached in a `WeakMap<InventoryItem, string>`. Item edits always replace the object, so the cache invalidates automatically.
- `buildInventorySearchMatcher(query)` tokenizes once and returns `(item) => tokens.every(t => haystack(item).includes(t))`.
- `matchesInventorySearch(item, query)` is unchanged in results; it now hits the same cache.

---

## Affected files

| File | Role |
| --- | --- |
| `components/InventoryList.tsx` | QW1 deferred term; QW2 stable widths + layout-effect deps; QW7 lookup wiring; QW6 matcher in the filter and bundle-reopen effect |
| `utils/inventorySearchIndex.ts` | QW6 WeakMap haystack + `buildInventorySearchMatcher` |
| `services/financialAggregation.ts` | QW7 `InventoryLookup` / `buildInventoryLookup` and O(1) helper paths |
| `scripts/verify-search-equivalence.ts` | Frozen pre-sprint copies vs live helpers (49,600 checks) |
| `scripts/bench-search-filter.ts` | Legacy vs optimized filter-loop bench |
| `scripts/verify-active-search-excludes-sold.ts` | Existing sold-leak guard (still passes) |

No other application screens were refactored. Helpers remain backward-compatible without a lookup argument.

---

## Before measurements (pre-sprint baseline)

### Filtering complexity

Per keystroke, Active tab, N items, C containers, H average children:

- Status gate: `itemMatchesActiveInventoryTab` → `getParentContainer` → `items.find` = **O(N) per item → O(N²)**
- Container search: `getChildren` → `items.find` per componentId, else `items.filter` = **O(N) per container**
- Haystack: rebuild name+specs+comments+URL string + `toLowerCase()` **per item per keystroke**
- Query: `tokenize` **per item**
- Split view: the above × 2 (Active pane + Sold pane), plus a combined pass

### Filter-loop wall time (Node, 1,998 items, 162 containers, 3-round median)

Script: `npx tsx scripts/bench-search-filter.ts` — legacy path uses frozen haystack (no WeakMap) and no lookup maps.

| Query | ACTIVE (legacy) | matches | SOLD (legacy) | matches |
| --- | ---: | ---: | ---: | ---: |
| `g` | 0.65 ms | 878 | 0.14 ms | 645 |
| `gt` | 2.17 ms | 291 | 0.57 ms | 241 |
| `gtx` | 1.85 ms | 291 | 0.67 ms | 241 |
| `gtx ` | 1.79 ms | 291 | 0.80 ms | 241 |
| `gtx 1` | 2.64 ms | 291 | 0.63 ms | 241 |
| `gtx 10` | 2.44 ms | 242 | 0.84 ms | 199 |
| `gtx 108` | 1.83 ms | 164 | 0.86 ms | 141 |
| `gtx 1080` | 2.11 ms | 164 | 1.01 ms | 141 |
| **8-keystroke total** | **15.5 ms** | | **5.5 ms** | |

Active is slower than Sold because the Active status gate walks parents for every `IN_COMPOSITION` row.

### Search input / React renders (pre-sprint, from audit of `HEAD` code — not a Profiler recording)

On each keystroke the audit traced:

- 1 full `InventoryList` render (8.8k-line body)
- 1–3 full `filterAndSortInventoryItems` passes (sync, not deferred)
- Canvas auto-width over ≤120 rows
- Flags `useLayoutEffect` with **no deps** → `querySelectorAll` + possible extra commit
- New `effectiveColumnWidths` identity → new `renderRowCells` → **all visible rows re-render** (~30/pane × 2 panes in split view)
- No network, no URL write

React Profiler could not be recorded on the pre-sprint UI in this session (see note at top).

---

## After measurements

### Filtering complexity

- Lookup build: **O(N) once per `items` identity**, not per keystroke
- Per keystroke: **O(N)** membership tests + O(1) parent/child gets
- Haystack: **O(1)** WeakMap hit after the first build for that item object
- Tokenize: **once per pass**

### Filter-loop wall time (same dataset, same queries, result counts identical)

| Query | ACTIVE (optimized) | matches | SOLD (optimized) | matches |
| --- | ---: | ---: | ---: | ---: |
| `g` | 0.12 ms | 878 | 0.12 ms | 645 |
| `gt` | 0.32 ms | 291 | 0.28 ms | 241 |
| `gtx` | 0.29 ms | 291 | 0.20 ms | 241 |
| `gtx ` | 0.32 ms | 291 | 0.24 ms | 241 |
| `gtx 1` | 0.35 ms | 291 | 0.19 ms | 241 |
| `gtx 10` | 0.28 ms | 242 | 0.39 ms | 199 |
| `gtx 108` | 0.41 ms | 164 | 0.22 ms | 141 |
| `gtx 1080` | 0.33 ms | 164 | 0.32 ms | 141 |
| **8-keystroke total** | **2.4 ms** | | **2.0 ms** | |

| Tab | Before | After | Speedup |
| --- | ---: | ---: | ---: |
| ACTIVE | 15.5 ms | 2.4 ms | **6.4×** |
| SOLD | 5.5 ms | 2.0 ms | **2.8×** |

Per qualifying keystroke on Active: **~2.1 ms → ~0.3 ms**.

### Search input responsiveness (QW1)

The character is committed to `searchTerm` on the urgent path; the 2.4 ms filter work is scheduled behind `useDeferredValue`. The input is no longer gated on finishing `filterAndSortInventoryItems` before paint.

### Number of renders / visible row re-renders (QW1 + QW2)

| Event | Before | After |
| --- | --- | --- |
| Urgent input paint | Blocked behind filter + width + row tree | Paints with previous deferred list |
| Flags DOM measure | Every `InventoryList` render (no effect deps) | Only when `items` or `listDensity` change |
| Extra measure `setState` commit on search | Yes (reset width to 0 on every filtered-list identity, then grow) | No — reset is keyed on `items` / `listDensity` |
| `renderRowCells` identity on search | New every keystroke (width object churn) | Stable when pixel widths are unchanged |
| Visible `InventoryTableRow` re-renders on search | All mounted rows (~30–60) | **0** attributed to width identity; rows still update when the deferred *item list* actually changes (correct) |

When the deferred query changes the filtered set, rows that stay in view keep the same `item` object refs, so `React.memo` still skips them unless `rowActivityKey` / selection / highlight changes. New matches mount; dropped matches unmount. That is required for correctness, not churn.

---

## Behavioral differences

**None intended, none found.**

`npx tsx scripts/verify-search-equivalence.ts` — **ok (49,600 checks, 800 items)** including:

- `matchesInventorySearch` vs frozen haystack/token AND-match, all queries (empty, 1-char, multi-token, URL/`userId`, extra whitespace, mixed case)
- `buildInventorySearchMatcher` vs the same reference
- `getChildren` / `getParentContainer` / hide / Active-tab / sold-part surface / container-or-child match, **with and without** lookup, including stale `componentIds` and missing `parentContainerId`

`npx tsx scripts/verify-active-search-excludes-sold.ts` — **ok** (sold-PC parts still never appear on Active).

The filter bench asserts optimized match **counts** equal the legacy path for every keystroke on both tabs.

Search still:

- Ignores queries shorter than 2 characters
- AND-matches tokens across name, category, comments, vendor, SKU, order id, invoice, customer, specs, Kleinanzeigen profile URL / userId
- Surfaces the parent PC/bundle when a child matches, without promoting the child to a top-level row
- Respects Active / Sold / Drafts tabs during search

---

## Remaining bottlenecks (out of sprint scope)

These are unchanged and still on the performance-audit roadmap:

1. **`InventoryList` is still one 8,858-line component.** `useDeferredValue` keeps the *filter* off the urgent path, but the component function still runs on every keystroke because the input lives in the same component. Splitting the search box into a child that does not own the table would cut urgent work further.
2. **Split view still runs two full O(N) passes** (Active + Sold). Cheap now (~0.3 ms each) but still redundant with a combined pass.
3. **Mobile list is unvirtualized** — every match mounts a `MobileStockCard`.
4. **Canvas auto-width** still samples up to 120 filtered rows when the deferred list changes (not on the urgent keystroke).
5. **God-state `App`** still re-renders the shell on item edits (not on search typing).
6. **Hub-archive `findHubArchiveOrderById` is still a linear scan** — not on the search path.

Do not start those until this sprint is accepted.

---

## How to re-run

```bash
npx tsx scripts/verify-search-equivalence.ts
npx tsx scripts/verify-active-search-excludes-sold.ts
npx tsx scripts/bench-search-filter.ts
```

Optional live typing (requires signed-in inventory tab + Chrome CDP `:9222`, tab in foreground):

```bash
node scripts/bench-search-live.mjs after-sprint
```
