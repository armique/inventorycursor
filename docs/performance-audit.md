# Performance Audit — Inventory Pro Admin Panel

**Date:** 2026-08-22
**Method:** Static execution-flow tracing of the actual implementation (5 parallel deep code investigations: search path, persistence layer, file parsing, network/API layer, render architecture). No code was modified. Live browser profiling was not possible in this session (panel requires Google sign-in), so timing figures are engineering estimates derived from the code's algorithmic complexity — each finding cites exact file/line evidence so it can be verified with the React Profiler / Performance tab.

**Architecture context (affects every finding):** This is a client-heavy Vite + React 19 SPA. There is no traditional database — the "data layer" is a single `items` array held in `App.tsx` state, persisted to `localStorage`/IndexedDB and mirrored to Firestore as a sharded "sync pack". "Backend" endpoints are Vite dev-middleware / Vercel functions, several of which drive Playwright browser scraping. The classic DB concerns (indexes, N+1, joins) translate here to: **repeated linear scans of in-memory arrays, full-dataset serialization, and full-dataset cloud writes.**

---

## Executive summary — why the app feels slow

Every symptom traces back to five structural patterns:

1. **Quadratic, un-debounced search.** Each keystroke synchronously re-filters all N items, and the per-item helpers themselves scan all N items again — O(N²), executed 2–3× in split view.
2. **Render amplification.** One keystroke or one cell edit re-renders an 8,858-line `InventoryList` component and, on edits, the 2,810-line `App` plus everything holding `items`. Column auto-width churn defeats the row-level `React.memo` on every keystroke.
3. **Full-dataset persistence.** Any single edit re-serializes the entire inventory to localStorage (then parses it *again* for a side index) and pushes the whole sharded pack to Firestore. Signed-out photo imports embed base64 images directly into that JSON, multiplying every one of these costs.
4. **Main-thread file processing.** Image compression, XLSX/CSV parsing, invoice rasterization, and backup stringify all run synchronously on the UI thread with zero Web Workers — these are the "freezes".
5. **Heavy automatic network work.** A Playwright Seller-Hub scrape (up to 180 s) fires 5 s after every panel visit; single-order scrapes take 30–60 s each; AI flows run strictly sequentially per item.

---

## Phase 1 — Investigation findings by stage

### Frontend: what happens on one search keystroke

Traced call chain (no debounce, no `useDeferredValue` on `searchTerm`):

```
<input onChange> → setSearchTerm                        InventoryList.tsx:6202 (desktop), :5952 (mobile)
→ full InventoryList re-render (8,858-line component body, all hooks)
→ listFilterParams memo rebuild                          :2720
→ filterAndSortInventoryItems (sortedItems)              :2763  — O(N × per-item cost)
→ + sortedActiveItems + sortedSoldItems in split view    :2768, :2773 — two MORE full passes
→ computeAutoColumnWidths (canvas measureText, ≤120 rows):2787 → :810
→ measuredPresenceWidth reset effect                     :2803
→ useLayoutEffect flags DOM measure (NO dependency array — every render) :2806
→ effectiveColumnWidths new identity → renderRowCells new identity        :2819, :5273
→ row React.memo comparison fails (renderRowCells prop)  :8278 — ALL visible rows re-render
→ 2× InventoryListTablePane re-render (split view)
→ post-paint effects: bundle-reopen scan (:2007), scroll reset (:2876)
```

Per-item cost inside the filter (per keystroke, per pass):

- `matchesInventorySearch` **rebuilds the full haystack string** (name + category + comments + all specs entries + URLs, joined + `toLowerCase()`) for every item on every call — `utils/inventorySearchIndex.ts:31–61`. No caching, no index (the scored `searchInventory` "index" in the same file is never used by the list).
- Container rows call `containerOrChildMatchesSearch` → `getChildren` which does `componentIds.map(id => items.find(...))` — **O(children × N)** — `services/financialAggregation.ts:16–25, 208–217`.
- Active-tab gating calls `itemMatchesActiveInventoryTab` → `isPartOfRealizedContainer` → parent scans — more O(N) per item — `financialAggregation.ts:162–167`.

**Net effect:** with ~2,000 items the filter alone is millions of operations per keystroke, before rendering. Virtualization exists on desktop (threshold 40 rows, overscan 12 — `InventoryList.tsx:8070, 8142`), but **mobile renders every match with no virtualization** (`:7047–7134`).

What typing does **not** do (already healthy): no network calls, no URL writes, and preference persistence to localStorage is batched behind a 200 ms debounce (`:1969–2004`).

### State/persistence: what happens on one cell edit

```
handleUpdate → new items array                            App.tsx:1875–2047
→ setItems + setHistory (undo) + often setActionHistory   — full App re-render
→ PanelLayout, GlobalSearch (memo defeated: items identity), SettingsModalHost (mounted, returns null) all re-render
→ after 400 ms quiet: JSON.stringify(ENTIRE items array)  utils/cloudSyncTiming.ts:14, services/backgroundPersistence.ts:34–74
   → then JSON.parse of that same string again to rebuild the sales pool (backgroundPersistence.ts:38)
→ after 200 ms: cloud push of the FULL sync pack           App.tsx:1568–1704, firebaseService.ts:1418
   (sanitize/trim walk of whole payload, stringify for size checks, shards ≤ ~680 KB)
```

Startup: `inventory_items` + trash + expenses + settings + history are all `JSON.parse`d eagerly on the main thread before the panel is interactive (`App.tsx:424–541, 1017–1075`). With base64 photos embedded (signed-out mode stores compressed data URLs up to ~380 K chars **per photo** — `utils/imageCompress.ts:31–37, 253–259`), this is a multi-MB parse.

### Backend / API

| Endpoint / Operation | Current Problem | Suspected Cause | Priority |
| --- | --- | --- | --- |
| Firestore `writeToCloud` (`firebaseService.ts:1418`, trigger `App.tsx:1696`) | Every edit rewrites the whole inventory pack (meta + core + all item shards) after 200 ms | Full-dataset sync model; no dirty-shard diffing | **P1** |
| `POST /api/ebay-hub-archive-sync` (auto, `PanelLayout.tsx:171` +5 s after mount) | Playwright scrape up to **180 s** on every local panel visit; POST body carries ~950+ known order IDs | Unconditional visit-triggered sync, no TTL/session gate | **P1** |
| `POST /api/ebay-seller-hub-fetch` (`ebaySellerHubFetch.ts:39`) | 30–60 s browser scrape per order-bind/breakdown; bind retries once (doubles cost) | Live scrape with no short-TTL result cache beyond archive | **P2** |
| AI spec loops (`BulkItemForm.tsx:666–701`, `InventoryList.tsx:3802`) | Bulk confirm & bulk listing text run **one item at a time**, sequentially | `for … await` loops; no concurrency pool | **P2** |
| `InventoryAISpecsPanel.tsx:116–141` | 12-way parallel burst then fixed **60 s** idle between batches (120 s on 429) | Hard-coded batch cadence — too hot, then too idle | **P3** |
| Daily forced `ensureEbayListings({force:true})` + KA refresh (`App.tsx:1356`) | Full live listing refetch on first boot of the day, overlapping the cloud pull of the same data | Force flag ignores freshness of the just-pulled cloud copy | **P3** |
| `EbaySalesMatchReviewModal` (mount) | Live `fetchEbayOrder` on every open | No response cache | **P3** |
| `GET /api/ebay-hub-browser-ingest` | 2.5 s polling up to 180 s while "listening" | Busy-poll design (acceptable, user-initiated) | P4 |
| SavedSearches auto deal-search (30 min, sequential + 2 s gaps) | Long tail of Gemini calls | Only mounts on an orphaned route — verify it's ever active | P4 |

### "Database" (in-memory arrays + caches)

- **Repeated linear scans:** `findHubArchiveOrderById` is `orders.find(o => o.orderId.trim().toLowerCase() === key)` — O(orders) per call (`services/ebayHubArchiveIndex.ts:519–523`). Called per sold row (via `hubRefundFallbackEur`, `resolveSellColumnSplit`) and inside the column-width sampling loop → **O(rows × orders)** per render. The archive itself is memory-cached (good); the lookup is not indexed.
- **The equivalent of missing indexes:** no `Map` for item-by-id / children-by-parent inside the filter helpers (`items.find` everywhere in `financialAggregation.ts`), no per-item search haystack cache.
- **The equivalent of SELECT \*:** every persistence/sync path serializes all columns of all rows, always.

### File parsing / processing (the "freezes")

| Workflow | Blocks UI? | Parallelism | Key locations |
| --- | --- | --- | --- |
| Image compress + upload (add photos, bulk archive) | **Yes** — canvas draw + `toBlob` quality re-encode loops on main thread | Strictly sequential per file | `utils/imageCompress.ts:99–177`, `services/inventoryImageStorage.ts:520–575` |
| XLSX sheets import | **Yes** — full-sheet sync parse; **entire sheet re-processed on every header/locale/mapping change** | Single-threaded | `components/SheetsImport.tsx:149–311` |
| eBay CSV / Hub archive JSON import | **Yes** — char-by-char CSV parse; archive JSON parsed **twice** (detect + parse) | Sync | `services/ebayOrderCsvImport.ts:170–445`, `utils/ebayHubArchiveFile.ts` |
| Invoice PDF | **Yes** — html2canvas at scale 2 rasterizes whole sheet into one canvas | Sync raster | `utils/downloadInvoice.ts:77–140` |
| Backup export / GitHub push / daily snapshot | **Yes** — full-dataset `JSON.stringify` (pretty-printed for manual export) | Sync | `SettingsPage.tsx:531–553`, `services/backupService.ts:146–159` |
| Bulk paste parse (AS-IS / AI) | Parse only on button click (healthy) — not per keystroke | — | `components/BulkItemForm.tsx:363–468` |

**Zero Web Workers / OffscreenCanvas / createImageBitmap anywhere in these paths.**

### Render architecture

- Routes correctly unmount when inactive; many pages are `React.lazy` (good). Storefront/panel boot is split (good).
- But: full `items` is props-drilled into `PanelLayout`, `GlobalSearch` (memo always defeated by array identity), and the always-mounted `SettingsModalHost` — all re-render on every edit.
- Dashboard memoizes its ~15 aggregations but recomputes all of them on every `items` change while mounted, even on tabs that don't show them (`Dashboard.tsx:324–854`).
- Column-resize drags call `setColumnWidths` on **every mousemove** with no rAF throttle (`InventoryList.tsx:2985–3002`).
- Eager `@google/genai` is pulled into the panel shell via `QuotaMonitor → geminiService` (bundle + init cost on every panel boot). `recharts` is not in `manualChunks`.
- A 1 s `setNow` ticker runs while the phone-upload QR panel is open (`PhoneUploadQrPanel.tsx:66–68`).

---

## Phase 2 — TOP 10 PERFORMANCE BOTTLENECKS

### 1. Un-debounced, quadratic search on every keystroke

- **Problem:** Typing in the inventory search is laggy; each character stalls the UI.
- **Exact location:** `components/InventoryList.tsx:6202/5952` (raw `setSearchTerm`), `:991–1193` (`filterAndSortInventoryItems`), `:2763–2776` (up to 3 full passes); `services/financialAggregation.ts:16–25, 162–167, 208–217` (O(N) helpers called per item); `utils/inventorySearchIndex.ts:31–61` (haystack rebuilt per item per call).
- **Root cause:** No debounce/`useDeferredValue` on the term feeding the filter; filter is O(N²) because `getChildren`/`isPartOfRealizedContainer` scan the full array per item; haystack strings and query tokens are recomputed per item per keystroke; split view triples the passes.
- **Impact:** **Critical** — the single biggest contributor to "search is laggy". Scales quadratically, so it degrades sharply as inventory grows.
- **Recommended fix:** (a) feed the filter through `useDeferredValue(searchTerm)` so typing paints immediately; (b) build `Map` lookups once per `items` change (itemById, childrenByParentId, parentById — a `hiddenChildIds` set already exists at `:2708`, extend the pattern) and pass them into the helpers; (c) cache each item's haystack in a `WeakMap<InventoryItem, string>` (items are immutable-by-replacement, so invalidation is automatic); tokenize the query once per pass.
- **Complexity:** Medium (touches shared helpers, but mechanical).
- **Expected improvement:** Filter pass goes from O(N²) to O(N) with ~10× lower constant; with N=2,000, per-keystroke filter cost drops from an estimated 100–400 ms to **< 10 ms**, and typing latency becomes imperceptible because rendering is deferred off the input.

### 2. Row memoization defeated every keystroke by column-width churn

- **Problem:** All visible rows (both panes) re-render on every keystroke even though row data didn't change.
- **Exact location:** `components/InventoryList.tsx:5273–5277` (`renderRowCells` depends on `effectiveColumnWidths`), `:2787–2833` (auto-width memo + measured-width reset per filtered-list identity), `:2806–2817` (`useLayoutEffect` with **no dependency array** running `document.querySelectorAll` after every render — added 2026-08-22), row memo check at `:8278`.
- **Root cause:** Width objects get a new identity per keystroke (auto-width recompute + flags re-measure + reset effect), which invalidates the `renderRowCells` callback that the row `React.memo` compares by reference. The layout effect also issues an extra React commit whenever the measured width changes.
- **Impact:** **High** — multiplies bottleneck #1 by forcing full row-tree renders (the Flags cell is the most expensive cell) and adds a per-render DOM measurement pass.
- **Recommended fix:** Give the flags-measure layout effect a dependency list (re-measure only when `autoWidthSourceItems`/density/columns change); reset measured width only when the underlying `items` change, not on every filtered-list identity; decouple row rendering from width-object identity (deliver widths via `<colgroup>`/CSS variables only, or keep `renderRowCells` stable via ref — the `renderCellRef` pattern already exists).
- **Complexity:** Low–Medium.
- **Expected improvement:** Row re-renders per keystroke drop from ~60 (2 panes × ~30 rows) to ~0; removes one extra commit + layout pass per render.

### 3. Every edit re-serializes and re-uploads the entire dataset

- **Problem:** Editing one cell triggers full-inventory JSON.stringify locally and a full sync-pack rewrite in Firestore; rapid edits keep the main thread and network busy.
- **Exact location:** `services/backgroundPersistence.ts:34–74` (full stringify after 400 ms; then **`JSON.parse` of the same string** at `:38` to rebuild the sales pool), `App.tsx:720–757` (sync variant), `App.tsx:1568–1704` + `services/firebaseService.ts:1418` (full pack push at 200 ms debounce; sanitize/trim walks + size-check stringifies of the whole payload).
- **Root cause:** Snapshot-based persistence with no dirty tracking; a derived index is rebuilt by round-tripping the JSON; cloud shards are rewritten even when unchanged.
- **Impact:** **High** — constant background main-thread serialization work during any editing session; Firestore write amplification; multi-device echo churn.
- **Recommended fix:** Pass the already-in-memory array to the sales-pool builder (delete the parse round-trip — trivial); hash/compare shards and skip unchanged ones in `writeToCloud`; lengthen the cloud debounce for continuous edits (keep the 0 ms fast path only for discrete actions, which already exists); longer-term, move stringify into a Web Worker.
- **Complexity:** Low (parse round-trip, shard skip) to Medium (worker).
- **Expected improvement:** ~50 % of per-edit serialization cost removed immediately; Firestore writes per edit drop from "all shards" to only dirty shards (often 1–2 instead of dozens).

### 4. Base64 photos embedded in the inventory JSON (signed-out mode)

- **Problem:** Everything gets slower when photos exist: boot parse, every persist, every cloud sanitize walk, localStorage quota errors.
- **Exact location:** `utils/imageCompress.ts:31–37` (`INVENTORY_PHOTO_LOCAL_OPTIONS`, ~380 K chars/photo), `:253–259` (data-URL fallback), `services/inventoryImageStorage.ts:452–459`; also raw uncompressed `readAsDataURL` for chat proofs (`BulkItemForm.tsx:581–587`, `SaleModal.tsx:456–487`).
- **Root cause:** When not signed in (or for chat/receipt screenshots), images are stored inline in the items array instead of a blob store, so every serialization/parse/sync pays for them.
- **Impact:** **High** for signed-out or screenshot-heavy usage — turns `inventory_items` into a multi-MB payload that taxes bottlenecks #3 and boot time.
- **Recommended fix:** Store local image blobs in IndexedDB (the infrastructure already exists — hub archive and product-card gallery both use IDB) and keep only a small reference key on the item; compress chat proofs before storing.
- **Complexity:** Medium (migration path for existing embedded images needed).
- **Expected improvement:** Inventory JSON shrinks from potentially tens of MB to hundreds of KB; boot parse and every persist/sync proportionally faster; quota errors eliminated.

### 5. Automatic 180 s Playwright scrape on every panel visit

- **Problem:** 5 s after opening the admin panel locally, a Seller-Hub incremental scrape spawns Chrome-CDP Playwright work for up to 3 minutes, competing for CPU while the user works.
- **Exact location:** `components/PanelLayout.tsx:171` (visit trigger), `services/ebayHubArchiveSync.ts:447`, `api/ebay-seller-hub-fetch.js:63` (child process, 180 s budget); request body carries all ~950+ known order IDs.
- **Root cause:** Unconditional visit-triggered sync with no freshness gate (no "last synced X minutes ago, skip").
- **Impact:** **High** during the first minutes of every session (exactly when users notice sluggishness) — CPU contention from the scraping browser + dev-server child process.
- **Recommended fix:** Gate the auto-sync behind a TTL (e.g., skip if synced within the last 6–12 h), persist last-sync timestamp, keep manual sync in the Hub tab; send only a count/high-watermark instead of the full known-ID list.
- **Complexity:** Low.
- **Expected improvement:** Heavy scrape runs at most once per TTL window instead of every visit; panel-open sessions no longer start with 3 minutes of background CPU load.

### 6. All file processing on the main thread, sequential (images worst)

- **Problem:** Importing/archiving photos and importing spreadsheets freezes the UI.
- **Exact location:** `utils/imageCompress.ts:99–177` (canvas draw + repeated `toBlob` quality loops), `services/inventoryImageStorage.ts:520–575` (strictly sequential per file, HEIC via heic2any inline), `SettingsPage.tsx:432–469` (bulk archive loop); `components/SheetsImport.tsx:268–311` (sync XLSX parse) + `:149–258` (full-sheet reprocess on any mapping change).
- **Root cause:** No Web Workers anywhere; encode/parse loops run synchronously; batches are serial so total time = sum of items.
- **Impact:** **High** for the "features that parse files take a long time / app freezes" symptom. A 20-photo import = 20 × (decode + multiple re-encodes + upload) serially on the UI thread.
- **Recommended fix:** Move image decode/resize/encode into a Worker pool (2–3 concurrent) using `createImageBitmap` + `OffscreenCanvas`; keep uploads throttled-parallel. Move XLSX parsing into a worker and cache the parsed grid so remapping doesn't re-parse.
- **Complexity:** Medium–High (worker plumbing), but isolated per feature.
- **Expected improvement:** UI stays interactive during imports; multi-photo import wall-time roughly 2–3× faster from parallelism; sheet remapping becomes instant after first parse.

### 7. God-state `App`: one edit re-renders the whole shell

- **Problem:** Any inventory mutation re-renders `App` (2,810 lines), `PanelLayout`, `GlobalSearch`, the always-mounted `SettingsModalHost`, and the active page — plus double state updates for undo history.
- **Exact location:** `App.tsx:1875–2047` (`handleUpdate` wholesale array replace + `setHistory`), `:2603–2670` (full `items` drilled into layout/search/settings host); `GlobalSearch` memo defeated by array identity.
- **Root cause:** Single top-level state array with no selector/subscription layer; consumers receive the array itself, so identity changes propagate everywhere.
- **Impact:** **Medium–High** — makes every edit pay a fixed multi-component tax; combined with #2 it's why inline editing feels delayed.
- **Recommended fix:** Short term: stop passing `items` to components that only need derived scalars (pass counts/ids computed in `App` memos); memoize route children. Longer term: move inventory into a subscription store (zustand or context-with-selectors) so only interested components re-render.
- **Complexity:** Medium (short term) / High (store migration).
- **Expected improvement:** Edit-time re-render scope shrinks from "whole shell + page" to "affected rows + summary widgets"; keystroke cost during inline editing drops accordingly.

### 8. Hub-archive lookups are linear scans per row per render

- **Problem:** Sold rows and width measurement repeatedly linear-scan the full Hub order ledger.
- **Exact location:** `services/ebayHubArchiveIndex.ts:519–523` (`findHubArchiveOrderById` = `orders.find` with per-order `trim().toLowerCase()`); hot callers: `InventoryList.tsx:550–556` (`hubRefundFallbackEur`), `utils/sellColumnDisplay.ts:92–93`, width sampling loop `InventoryList.tsx:873–885`.
- **Root cause:** No id → order `Map`; the good pattern already exists (`buildHubSellDisplayByItemId` builds a Map once — `InventoryList.tsx:1333–1361`) but per-cell fallbacks bypass it.
- **Impact:** **Medium** — O(sold rows × hub orders) per render; with ~950 orders × 30 visible rows × multiple calls per row it adds milliseconds to every render, riding on top of #1/#2.
- **Recommended fix:** Maintain a lazily-built `Map<orderIdKey, order>` inside `ebayHubArchiveIndex` (invalidate on upsert), make `findHubArchiveOrderById` O(1).
- **Complexity:** Low.
- **Expected improvement:** Hub lookups drop from ~30,000 string ops per render to ~30 map hits; measurable render-time reduction on the SOLD tab.

### 9. Sequential AI loops in bulk flows

- **Problem:** Bulk-import confirm and bulk listing generation process items one at a time; users wait N × (latency + provider fallback + 429 retries).
- **Exact location:** `components/BulkItemForm.tsx:658–716` (sequential `generateItemSpecs` per item), `components/InventoryList.tsx:3802` (sequential listing text), `components/InventoryAISpecsPanel.tsx:116–141` (12-parallel bursts then fixed 60 s sleeps).
- **Root cause:** `for … await` loops with no shared concurrency pool; the batch panel's fixed cadence is either too aggressive (burst of 12) or too idle (60 s wait).
- **Impact:** **Medium** — doesn't block the UI thread, but is the main reason "features take a long time to complete" for AI flows (e.g., 30 items × 4 s ≈ 2 min instead of ~30 s).
- **Recommended fix:** One shared promise-pool (concurrency 3–4) with adaptive backoff on 429, reused by all three flows.
- **Complexity:** Low–Medium.
- **Expected improvement:** Bulk AI wall-time ÷ 3–4; no more fixed 60 s dead air between batches.

### 10. Mobile list renders every match; boot parses everything eagerly

- **Problem:** (a) On mobile widths, search results render as an unvirtualized full list of `MobileStockCard`s. (b) Panel boot main-thread-parses the entire dataset before first paint.
- **Exact location:** (a) `components/InventoryList.tsx:7047–7134` (`sortedItems.map` — no virtualizer, unlike desktop `:8086–8242`). (b) `App.tsx:424–541, 1017–1075` (eager `JSON.parse` of items/trash/expenses/history in state initializers).
- **Root cause:** Virtualization was only added to desktop panes; boot loads all satellite datasets synchronously even though only the active route needs them immediately.
- **Impact:** **Medium** — mobile search with hundreds of matches mounts hundreds of card components; boot delay grows with dataset size (severe when #4 applies).
- **Recommended fix:** Reuse the existing `useVirtualizer` for the mobile card list; defer non-critical boot parses (history, bulk imports, trash) to idle callbacks after first paint.
- **Complexity:** Low–Medium.
- **Expected improvement:** Mobile search render cost bounded to ~viewport cards regardless of match count; measurable time-to-interactive improvement on boot for large datasets.

**Honorable mentions (tracked for the roadmap, not top-10):** column-resize `mousemove` → `setState` unthrottled (`InventoryList.tsx:2985`); eager `@google/genai` in the panel shell via `QuotaMonitor`; static `exceljs` import in `finanzamtExportService.ts` (verify it's tree-shaken out of the main chunk); archive JSON parsed twice on import; invoice html2canvas at scale 2; 1 s QR-panel ticker; `EbaySalesMatchReviewModal` live fetch on every open; per-open Dashboard recomputing all memos on tabs that don't show them.

---

## Phase 3 — QUICK WINS

Ranked by impact ÷ (risk × complexity). All are grounded in the findings above — nothing generic.

| # | Quick win | Where | Complexity / Risk | Expected effect |
| --- | --- | --- | --- | --- |
| QW1 | `useDeferredValue` on the term feeding `filterAndSortInventoryItems` (input stays raw-bound) | `InventoryList.tsx:2720–2776` | Low / Low | Typing paints instantly; filtering happens off the urgent path. Biggest perceived-lag fix for its size. |
| QW2 | Dependency array + smarter reset for the flags `useLayoutEffect`; stabilize `renderRowCells` against width-object identity | `InventoryList.tsx:2803–2833, 5273` | Low / Low | Restores row memoization: ~60 avoided row renders + one avoided commit per keystroke. |
| QW3 | `Map`-based `findHubArchiveOrderById` | `ebayHubArchiveIndex.ts:519` | Low / Low | O(1) hub lookups; removes O(rows × orders) render tax on SOLD tab. |
| QW4 | Delete the stringify→parse round-trip in `persistSnapshotToLocalStorage` (pass the in-memory array to the sales-pool builder) | `backgroundPersistence.ts:38` | Low / Low | Halves per-edit persistence CPU. |
| QW5 | TTL gate on the auto Seller-Hub visit scrape | `PanelLayout.tsx:171`, `ebayHubArchiveSync.ts` | Low / Low | Removes up to 3 min of background CPU from most session starts. |
| QW6 | Haystack `WeakMap` cache + one-time query tokenization | `inventorySearchIndex.ts:31–61` | Low / Low | ~10× cheaper per-item match; automatic invalidation via item identity. |
| QW7 | Prebuilt children/parent `Map`s passed into filter helpers (extend the existing `hiddenChildIds` pattern) | `InventoryList.tsx:2708`, `financialAggregation.ts` | Medium / Low–Med | Kills the O(N²) term in search/filter. Slightly more invasive — touches shared helpers used by several screens. |
| QW8 | rAF-throttle column-resize `mousemove` | `InventoryList.tsx:2985` | Low / Low | Smooth drag-resizing. |
| QW9 | Skip-unchanged-shard check in `writeToCloud` | `firebaseService.ts:1418` | Medium / Medium | Firestore writes per edit drop to dirty shards only; less sync echo. Needs careful hashing to avoid missed writes. |
| QW10 | Lazy-import `@google/genai` inside `geminiService` call paths (QuotaMonitor currently drags it into the shell) | `QuotaMonitor.tsx`, `geminiService.ts:2` | Low / Low | Smaller panel boot bundle + faster init. |

Deliberately **not** quick wins (need design): worker pools (#6), IDB photo migration (#4), inventory store extraction (#7), mobile virtualization (needs UX testing of variable-height cards).

---

## Phase 4 — PERFORMANCE ROADMAP

### Priority 1 — Immediate fixes (visible lag / freezing today)

| Task | Area | Complexity | Risk | Expected benefit | Dependencies |
| --- | --- | --- | --- | --- | --- |
| QW1 Deferred search value | `InventoryList` | Low | Low | Keystroke latency < 16 ms perceived | None |
| QW2 Fix width-churn memo invalidation + layout-effect deps | `InventoryList` widths | Low | Low | ~0 unnecessary row renders per keystroke | None (do with QW1) |
| QW7 De-quadratic the filter (children/parent Maps) + QW6 haystack cache | `financialAggregation.ts`, `inventorySearchIndex.ts` | Medium | Low–Med | Filter O(N²)→O(N); search cost drops ~10–50× at N=2,000 | Verify with existing `verify-active-search-excludes-sold.ts` script |
| QW3 Hub archive Map lookup | `ebayHubArchiveIndex.ts` | Low | Low | SOLD-tab render tax removed | None |
| QW4 Remove persist parse round-trip | `backgroundPersistence.ts` | Low | Low | −50 % per-edit persist CPU | None |
| QW5 TTL-gate auto hub scrape | `PanelLayout`, `ebayHubArchiveSync` | Low | Low | Clean session starts | None |
| QW8 Throttle column resize | `InventoryList` | Low | Low | Smooth drags | None |

### Priority 2 — High-impact optimizations (responsiveness)

| Task | Area | Complexity | Risk | Expected benefit | Dependencies |
| --- | --- | --- | --- | --- | --- |
| Dirty-shard cloud writes (QW9) + longer continuous-edit debounce | `firebaseService.ts`, `App.tsx` | Medium | Medium | Firestore writes/edit ↓ ~90 %; less echo re-rendering | Shard hashing correctness; existing `verify-cloud-sync-*.ts` scripts |
| Image compression Worker pool (2–3 concurrent) | `imageCompress.ts`, `inventoryImageStorage.ts` | Medium–High | Medium | No UI freeze on photo import; 2–3× faster batches | Worker infra (first one in repo) |
| XLSX parse in worker + cache parsed grid across remaps | `SheetsImport.tsx` | Medium | Low | Sheet import no longer freezes; instant remap | Worker infra |
| AI promise pool (concurrency 3–4, adaptive backoff) shared by bulk flows | `BulkItemForm`, `InventoryList`, `InventoryAISpecsPanel` | Low–Med | Low | Bulk AI wall-time ÷ 3–4 | Provider rate limits |
| Mobile list virtualization | `InventoryList.tsx:7047` | Medium | Medium | Mobile search bounded to viewport | Variable-height card measurement |
| Defer non-critical boot parses (history, bulk imports, trash) to idle | `App.tsx` init | Low | Low | Faster time-to-interactive | None |
| Stop drilling `items` where only derived scalars are needed (`GlobalSearch`, `SettingsModalHost` closed state, `PanelLayout` badges) | `App.tsx`, `PanelLayout` | Medium | Low | Every edit stops re-rendering the shell | None |
| QW10 lazy genai; add `recharts` to `manualChunks`; verify `exceljs` chunk isolation | bundle | Low | Low | Smaller/faster panel boot | None |

### Priority 3 — Structural improvements

| Task | Area | Complexity | Risk | Expected benefit | Dependencies |
| --- | --- | --- | --- | --- | --- |
| Move local photos + chat proofs to IndexedDB blobs with reference keys (+ migration for embedded base64) | storage model | Medium–High | Medium | Inventory JSON ↓ from MB→KB; boot/persist/sync all proportionally faster; no quota errors | Migration + backup compatibility (backup/restore, GitHub push, encrypted export) |
| Inventory store with subscriptions/selectors (zustand or equivalent); undo as diffs instead of array snapshots | `App.tsx` state | High | Medium–High | Edit re-renders scoped to consumers; App stops being the bottleneck | Do after P1/P2 so wins are measurable independently; large test surface (`verify-critical-flows.ts`) |
| Split `InventoryList.tsx` (8,858 lines) into pane/row/cell/toolbar modules with narrow props | `InventoryList` | High | Medium | Maintainability + smaller re-render scopes; enables further memoization | After store extraction ideally |
| Backup/export stringify in a Worker; stream large exports | backup services | Medium | Low | No freeze on export/daily snapshot | Worker infra from P2 |
| Short-TTL cache for single-order Seller-Hub scrape results; no auto-retry on soft failure | `ebaySellerHubFetch`, `bindEbayOrderExact` | Low–Med | Low | Repeat binds/breakdowns instant; halves worst-case scrape time | None |
| Persist-per-key dirty tracking for localStorage (only rewrite changed keys) | `backgroundPersistence.ts` | Medium | Medium | Persist cost proportional to change size | None |

---

## Suggested measurement before/after (to validate, once fixes land)

1. React DevTools Profiler: record 10 keystrokes in search on the SOLD tab (split view) — compare commit count and total render time.
2. Performance tab: trace panel boot with a real dataset — measure `JSON.parse` time and time-to-interactive.
3. `performance.mark` around `filterAndSortInventoryItems` and `writeToCloud` — log N, duration.
4. Firestore usage dashboard: writes per editing session before/after dirty-shard change.
5. Import 20 photos — measure main-thread blocking time (Long Tasks API) before/after worker pool.

---

*No code changes have been made. Awaiting approval on which roadmap phase to start; recommended starting point is Priority 1 (QW1 + QW2 together, then QW7 + QW6, each independently verifiable).*
