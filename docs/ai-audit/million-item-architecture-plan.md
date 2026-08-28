# Scaling Architecture Plan — Built for 10,000, Extensible to 1,000,000

**Date:** 2026-08-28 (updated)
**Status:** P1 (per-item mirror) shipped. P2+P3 (full per-item-doc reads + UI pagination) is **paused by a deliberate course-correction — read "P2+P3 course-correction" below before resuming it.**
**Trigger:** User asked for a Firestore architecture that stays smooth well past current scale (currently ~1,000 items, expected to reach 10,000 then possibly 100,000+ over the coming years), with no hosted backend server, building on the incremental-shard-sync work already shipped 2026-08-22 (see `persistence-sync-deep-audit.md` / `persistence-sync-results.md`).
**Near-term design target: 10,000 items, on Firestore's free (Spark) tier if at all possible.** The architecture below is the same one that scales to 1,000,000 — nothing here needs to be re-architected later — but the migration is scoped and sequenced around 10,000 so it ships without a mid-migration cost or reliability regression.

## P2+P3 course-correction (2026-08-28) — read this before resuming P2+P3

P2+P3 was approved, then paused before any code was written, after deep research (three Explore agents across `App.tsx`, `InventoryList.tsx`, `Dashboard.tsx`, container/bundle logic, and search) showed it was far larger and riskier than the original scope implied, and not actually necessary for the 10,000-item near-term target. Full findings live in the plan-mode transcript from that date; the load-bearing points:

- **Six subsystems assume the full array is resident in memory**, not a loaded page: undo/redo (whole-array snapshots, `utils/appendUndoHistory.ts`), container/bundle invariant healing (`utils/containerMembershipInvariants.ts`), dashboard dedup/allocation math (`services/financialAggregation.ts`), all three search paths (global search, inventory-list search, eBay title-fuzzy-match), "select all"/one export path in `InventoryList.tsx`, and Price Lab comps (`utils/itemSalesPool.ts`). Converting all of them was, per that research, "realistically the majority of the total work" and touches business-critical, currently-correct logic — undo/redo especially, since it's a safety net for real mistakes.
- **Switching bulk reads to per-item docs would make read-quota usage *worse*, not better, at 10k items.** Firestore bills 1 read per document returned. Blob-shard reads cost ~15-30 reads to load the whole inventory (one per ~680KB shard); per-item-doc reads would cost up to 10,000 reads for that same load. Storage (10-20MB vs. 1 GiB cap) and write quota (already fixed by the Aug 22 incremental-shard-write sprint, plus the daily budget guard in `services/firestoreOpsCounter.ts`) aren't near-term constraints either.
- **Conclusion:** the 1,000,000-item framing over-scoped what this business needs right now. Keep the blob-shard model as the authoritative bulk-load path indefinitely — it's the cheap path at this app's real scale — rather than converging toward per-item docs prematurely.

**What shipped instead of P2+P3** (2026-08-28): a fixed bug in the P1 mirror where its change-detection cache reset on every reload (forcing a full re-mirror — up to 10k extra writes per reload at the 10k-item target), now persisted to `localStorage`; deduped the double-write of `action_history`/`bulk_imports` to localStorage (was written from both the main debounced persist effect and dedicated 1.2s effects — now only the dedicated effects); deduped the storefront catalog being published twice per edit cycle (was published from both a debounced items-effect and after every successful cloud sync — now only the debounced items-effect). `enforceContainerMembershipInvariants`'s clone-all-on-no-op (R4 from the Aug 22 audit) was checked and found already fixed in an earlier session — no change needed.

**Trigger to revisit P2+P3 later** — not a date, a measured signal:
- Item count approaches ~50,000-100,000 (where shard count/boot-parse time becomes the real bottleneck, not read quota).
- The daily ops counter (`services/firestoreOpsCounter.ts`) regularly approaches budget from real edit activity, not migration overhead.
- A specific new feature genuinely needs single-item access without the full array (barcode lookup, deep link) — the already-fixed P1 mirror alone can serve that, no UI rewrite needed.
- Measured main-thread hitches persist after the fixes above.

None of these were close as of this update.

---

## Why the current design has a ceiling regardless of the Aug 22 fix

The Aug 22 sprint made **writes** incremental (only changed shard documents get uploaded). It did not — and could not, given the shard model — make **reads** or **CPU packing** incremental. Every sync still:

1. Walks every item in memory and repacks them into ~680 KB JSON shard documents.
2. Calls `getDocs()` on the entire `syncPack` collection to know which shards to skip/delete.
3. On load, downloads and parses every shard to reconstruct the full array.

All three are `O(total items)`, every time, regardless of how many items actually changed. At today's item count this is a sub-second cost. At 10,000+ it starts to be felt; at 1,000,000 the app would be unusable long before you got there.

The fix isn't a bigger timeout. It's storing and querying items the way Firestore is designed to be used: **one document per item**, read and written individually, with Firestore's own indexes doing the filtering instead of the browser.

---

## Firestore free tier (Spark plan) — the actual numbers to design against

| Limit | Free (Spark) allowance |
| --- | --- |
| Stored data | 1 GiB total |
| Document reads | 50,000 / day |
| Document writes | 20,000 / day |
| Document deletes | 20,000 / day |
| Network egress | 10 GiB / month |

These reset daily (reads/writes/deletes) or are a hard cap (storage). Going over doesn't silently fail — Firestore requires upgrading to the **Blaze (pay-as-you-go)** plan to continue past the free quota. Important nuance: **Blaze keeps the exact same free daily quotas** — you are only billed for usage *above* them. Enabling Blaze is not "now it costs money," it's "now there's no hard wall if a busy day exceeds free quota." For a single-user, low-frequency-edit app like this one, realistic overage billing is cents to a few dollars a month, not a meaningful cost. I'd recommend enabling Blaze as a safety net regardless of the item-count target, purely so a sync spike doesn't hard-fail — see "Cost guardrails" below.

### What 10,000 items actually costs, with the target architecture

- **Storage:** ~1–2 KB/item document × 10,000 ≈ 10–20 MB. Nowhere near the 1 GiB cap — you could hold ~50,000–100,000 items in free storage alone.
- **Writes:** normal daily editing (tens of items) plus occasional CSV import bursts (hundreds of rows) stays in the low hundreds to low thousands of writes/day — comfortably under the 20,000/day free cap even on a heavy import day.
- **Reads:** this is the number that actually matters, and it's **entirely a function of whether pagination ships alongside the data-model change, not of item count**. With paginated queries (load ~50 items per screen, not the whole inventory), a full day of normal use — browsing lists, searching, opening the dashboard — lands in the low thousands of reads/day, regardless of whether you have 1,000 or 100,000 items, because you're only ever reading what's on screen.
- **Where it breaks:** only if the app is changed to read one document per item **before** pagination ships (see the danger zone below), or if the app is left, unpaginated, loading the *entire* collection on every reload at high item counts.

**Bottom line: at a 10,000-item target with pagination shipped as part of the same migration, this comfortably fits inside Firestore's permanently-free tier.** The million-item target is where storage (1 GiB) and, if you're not careful with reads, the daily quota would eventually require Blaze billing — but by then the app is generating real business volume that easily justifies a few dollars a month.

---

## The read danger zone — and how the revised plan avoids it

Originally this plan sequenced "switch to per-item docs, still loading everything into one array" (P2) as a step *before* "add pagination" (P3). That's a real risk: between those two steps, loading your whole inventory means **one read per item** instead of a handful of shard reads. At 10,000 items, that's up to 10,000 reads per full page load — reload the app ~5 times in a day and you're already at half the free daily read quota, something that never happens under the current shard model.

**Fix: P2 and P3 ship together, as one phase.** The per-item data model and the paginated read path land in the same release, so the app never spends real time in the "many reads, no pagination" configuration. This is reflected in the phase table below.

---

## Target architecture

### 1. Data model: one Firestore document per item

Replace `syncPack/{meta,core,i0..iN,t0..tN}` with:

```
users/{uid}/items/{itemId}          — one doc per inventory item
users/{uid}/trash/{itemId}          — one doc per trashed item
users/{uid}/meta/dashboard          — small precomputed rollups (see §3)
users/{uid}/meta/settings           — settings, categories, custom fields (unchanged, already small)
```

Firestore indexes every field of every document automatically (single-field indexes are free and automatic; composite indexes for combined filters are declared once, cost nothing to run). A query like "unsold items, sorted by addedDate" costs you the size of the *result page*, not the size of the collection.

**No server required.** The client SDK talks to Firestore directly. Security rules (a config file Firestore itself enforces, not a running process) restrict every document under `users/{uid}/…` to that user's own auth token. This is the same "serverless" model the app already uses — it just applies it per-document instead of per-blob.

### 2. Client: stop holding the whole inventory in one array

This is the real behavioral change. Today, `items` in `App.tsx` is the entire inventory, always fully loaded, and every screen (`InventoryList`, search, dashboard, bundle logic) reads directly from that array. That assumption cannot survive at scale — no browser should hold a huge array in memory or re-render from it on every keystroke, and (per the danger zone above) it also directly controls your daily read quota.

Replace it with:

- **List/table views** query a page at a time: `query(itemsRef, orderBy('addedDate', 'desc'), limit(50))`, then `startAfter(lastDoc)` for the next page. Matches the pagination the Abrechnung page already does locally — this pushes the same idea into the database.
- **Search** becomes a Firestore query (`where('nameLower', '>=', prefix)` style prefix search, or a dedicated search index — see §4) instead of `Array.prototype.filter` over everything in memory.
- **Bundle/container views** load a container's children by a `where('parentContainerId', '==', id)` query instead of scanning the full array.
- **Editing one item** reads/writes exactly that one document. No repack, no full-collection read, no shard math.

### 3. Dashboard and aggregate numbers: server-computed, not client-looped

Today, "this month's revenue," linked counts, etc. are recomputed by looping the in-memory array on every render — the exact source of the flicker bugs fixed earlier this week, and something that gets slower and read-quota-hungrier as item count grows.

Two complementary approaches, adopted together:

- **Firestore aggregation queries** (`getCountFromServer`, `getAggregateFromServer` with `sum()`/`average()`) run the count/sum *inside* Firestore and return one number — no documents downloaded. Aggregation reads are billed at a small fraction of a normal document read (roughly 1 read-equivalent per 1,000 index entries scanned), so this is cheap even at high item counts. Good for real-time "how many items match X" numbers.
- **Precomputed rollup document** (`meta/dashboard`), updated by a small increment on every relevant write (e.g. "sold today" adds to a running total) instead of recomputed from scratch. Costs one extra small write per relevant edit, zero reads to display. Good for numbers that don't need to be a live query (monthly revenue, sold counts).

Both are plain Firestore features — no Cloud Functions or server needed, though a Cloud Function *would* be the natural place to keep the rollup document consistent if the client-side increment logic ever gets fiddly. That's an optional hardening step, not a requirement.

### 4. Search at scale

Firestore's own query engine handles exact-match and prefix filters well, but not full-text/fuzzy search ("gtx 1080" matching "GTX1080 Ti"). Two options, pick when this becomes a real pain point (not before):

- **Client-side search over the currently-loaded page** (fine up to the tens-of-thousands range, since most searches are scoped to what's visible or a bounded recent window).
- **A hosted search index** (Algolia, Typesense, or Firestore's own newer full-text extensions) mirrored from Firestore via a lightweight sync — this is the one piece that plausibly wants *something* beyond raw Firestore at real scale, but it's a managed service, not a server you operate.

### 5. Local persistence and offline

Firestore's SDK already maintains its own local cache (IndexedDB-backed) of every document you've read, and serves reads from it when offline — this doesn't change with the per-item model, it gets *better*, because the cache holds individual documents instead of a few giant blobs that must be fully re-parsed to get anything out of them, and repeat reads of the same page within a session are served from cache rather than re-billed against the daily quota.

The current custom `localStorage` full-inventory mirror (`inventory_items`) becomes unnecessary for the primary data path once per-item docs + Firestore's cache exist — it can be retired or kept as a lightweight backup export, not the hot path.

---

## Cost guardrails (regardless of item count)

Independent of the migration, two things are worth doing to keep spending predictable as usage grows:

1. **Enable Blaze now, with a budget alert** (e.g. Google Cloud Billing budget set to alert at $1 and $5/month). This removes the hard failure mode of hitting a free quota mid-workday, while costing nothing unless you actually exceed the free allowances — which, per the numbers above, a paginated 10,000-item app shouldn't.
2. **Never ship a phase that reads the full collection without pagination already in place** — this is the one pattern that can turn "well-architected" into "quota blown" regardless of the underlying data model, and it's exactly what the revised phase sequencing below avoids.

---

## Migration path (phased, so nothing breaks mid-way)

| Phase | What ships | Risk | Can ship independently? |
| --- | --- | --- | --- |
| **P1** | Write a one-time migration script: read the current sharded pack, write one Firestore doc per item under `users/{uid}/items/{id}`. Keep the old shard sync running in parallel (dual-write) so nothing regresses if P2 has bugs. | Low — additive, old path untouched | Yes |
| **P2+P3 (combined)** | Switch reads to per-item docs **and** ship pagination together: paginated inventory list/search (`limit`/`startAfter`), container children by query. No standalone "load everything via per-item docs" step — avoids the read-quota danger zone entirely. | High — the largest single change, touches every list screen | After P1 |
| **P4** | Move dashboard numbers to aggregation queries + rollup document. Retire the client-side full-array reduce. | Medium | After P2+P3 |
| **P5** | Retire the old shard-pack sync path and the full-inventory `localStorage` mirror once P2-P4 are proven stable for a few weeks. | Low (cleanup) | Last |
| **P6 (only if needed)** | Hosted search index, if client-side/prefix search proves insufficient. | Medium, external dependency | Independent, whenever search pain shows up |

Each phase is individually shippable and revertible — nothing requires a single big-bang cutover, and the dual-write in P1 means a bug in the new path can't lose data, since the old path keeps working until you're confident enough to retire it in P5.

**Rough scope:** P1 (data model + dual-write, no UI/behavior change) is a contained, few-day effort, safe to do anytime. P2+P3 combined is the large piece — realistically the majority of the total work, since it touches every screen that currently assumes "all items are already in memory" (list, search, bundles, bulk edit, CSV import matching) *and* has to ship as one unit to avoid the read-quota gap. P4 is small and can happen anytime after P2+P3.

---

## The plan, in practice

Given the 10,000-item near-term target and the "keep spending sane" constraint:

1. **Now:** enable Blaze with a low budget alert (guardrail, not a cost commitment). Start **P1** — dual-write migration to per-item docs. Zero user-visible change, zero quota risk (it only adds writes to a new, currently-unread collection), and it de-risks everything after it by proving the new data model is correct against your real data before anything depends on it.
2. **Next real chunk of work:** **P2+P3 together** — per-item reads plus pagination, shipped as one release. This is the piece to schedule properly (not squeeze in alongside other bug fixes) since it's the highest-risk, highest-value phase and touches the most UI.
3. **Shortly after:** **P4** — dashboard numbers off aggregation queries / rollup doc. Small, low-risk, and directly fixes the class of "recomputed-from-everything" bugs like the flicker issue from earlier this week.
4. **Once P2-P4 have been stable for a few weeks:** **P5** cleanup — retire the old shard sync and the full-inventory localStorage mirror.
5. **P6 (hosted search)** stays parked until client-side search on a loaded page actually feels insufficient — no reason to add an external dependency before that's true.

This sequencing is built for your near-term 10,000 target, fits inside Firestore's free tier the whole way, and doesn't need to be redone if you later grow toward 100,000 or 1,000,000 — the only thing that changes at real scale is that Blaze billing becomes a genuine few-dollars-a-month line item instead of a zero-cost safety net, and storage eventually needs the paid tier past very roughly 500,000–1,000,000 items.

Say the word whenever you want to start P1 — it's low-risk and can run alongside everything that's already live.
