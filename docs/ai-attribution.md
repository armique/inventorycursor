# AI attribution, audit trail & pending inbox

How the panel tells the assistant's edits apart from yours, and how to review or undo them.

## Why a session is needed

Browser automation clicks the same buttons you do — the app cannot tell the difference on
its own. So the assistant explicitly opens an attribution session before editing. While a
session is open, a violet **AI mode on** banner sits at the top of the panel with a
**Turn off** button, and every write is diffed and logged.

Sessions expire on their own after 30 minutes of inactivity, so a forgotten session can
never quietly mislabel your own edits.

## Bridge API (`window.deinventory.ai`)

```js
// open a session — the context string is shown verbatim in the Done by AI feed
window.deinventory.ai.beginSession({ context: 'Kleinanzeigen chat with Felix M., 23.07.2026' });

// …normal UI interaction: forms, modals, toggles. All business logic and validation runs
//   exactly as it does for a human, so nothing is bypassed.

window.deinventory.ai.endSession();
```

Other methods:

| Method | Purpose |
|---|---|
| `status()` | `{ active, sessionId, context, startedAt, actionCount }` |
| `isActive()` | boolean |
| `setContext(str)` | change the source note mid-session (e.g. a different chat) |
| `addDeal(input)` | create a pending inbox transaction (see below) |
| `updateDeal(id, patch)` | update one |
| `addDealProof(id, {type, fileUrl, note})` | attach an already-uploaded proof file |
| `listDeals()` | read the current inbox transactions |

`addDeal` / `updateDeal` throw unless a session is open — inbox rows have no form to
drive, so this is the only write path for them and it must stay attributable.

```js
window.deinventory.ai.addDeal({
  direction: 'buy',                                // or 'sell'
  platform: 'kleinanzeigen.de',
  title: 'RTX 3060 12GB',
  counterparty: 'Felix Matthes',
  amount: 180,
  paymentType: 'Kleinanzeigen (Direkt Kaufen)',
  date: '2026-07-23',
});
```

## What gets recorded

Every AI write produces an `AiAction` in `ai_actions_v1` (mirrored to Firestore at
`users/{uid}/aiActions`), holding the full before/after values of the changed fields plus
the session's `sourceContext`. The touched record also gets `source`, `lastModifiedBy` and
`aiReviewStatus`.

Only business fields are diffed — images, chat screenshots, sync bookkeeping and live
marketplace prices are skipped (see `TRACKED_FIELDS` in `utils/aiDiff.ts`).

The cloud copy of the log is fetched only when the **Done by AI** page opens, so the audit
trail costs no reads during normal use.

## Reviewing

- Violet **AI** badge next to the name — permanent provenance mark, stays after review.
- 4px violet stripe on the row — only while a change is unreviewed.
- Counter next to **Done by AI** in the sidebar — unreviewed actions.
- **Source** filter in the inventory toolbar — AI touched / to review / manual only.

On **Done by AI** each entry shows the timestamp, a plain-language action name, the item
(click to jump straight to the highlighted row via `?focus=<itemId>`), a before → after
table, and the source context, with **Approve** / **Revert** per entry and **Approve all
shown** at the top.

### Revert

Revert is field-level. Each field is restored only if the record still holds the value the
AI wrote. If you edited that field afterwards, it is reported as a conflict and you choose:

- **Revert the rest, keep my edits** — restores only the untouched fields.
- **Overwrite everything** — restores the AI's fields too, discarding your later edit.

Reverting an AI-created item moves it to Trash (after a confirmation). A revert counts as a
manual edit and passes `skipFieldPreserve` so cleared fields stay cleared.

## Pending inbox

The Inventory **Inbox** tab (formerly Purchases) tracks deals from both platforms and both
directions until each is logically finished, then routes them into Active inventory or Sold.

Two stores feed one view (`utils/inboxEntries.ts`):

- `ebay_purchase_index_v1` — eBay buyer orders, untouched. Parse · Confirm · Ignore works
  exactly as before, and existing pending orders needed no migration.
- `pending_transactions_v1` — Kleinanzeigen buys/sells and manual/AI-entered deals.

Stages:

| Payment | Start stage | Becomes final when |
|---|---|---|
| Kleinanzeigen Direkt Kaufen | `awaiting_confirmation` | receipt confirmed (buy) / buyer confirms and payout is released (sell) |
| Cash · PayPal · Wire · eBay | `likely_complete` | you tick the soft "item in hand" toggle, then finalize |
| not paid yet | `pending` | payment recorded |

Direkt Kaufen is never treated as done on payment alone. Cash-style deals are marked
likely complete immediately; after three days without confirmation the row shows a
**Confirm?** chip — advisory only, nothing is blocked.

## Source links

Every record resolves three links — chat, order/listing, counterparty profile — shown as
chips on the item card and as a one-click icon in the inventory row and the inbox.

Records written before these fields existed are not migrated: `utils/sourceLinks.ts` falls
back to `kleinanzeigenChatUrl` / `kleinanzeigenBuyChatUrl` / `kleinanzeigenSellerProfileUrl`,
and **derives** eBay order and profile URLs from `ebayOrderId` / `ebayUsername`, which is
all eBay ever stored.

**The assistant cannot create a record without one.** `addDeal` and AI item creation throw
`MissingSourceLinkError`. Two documented exemptions: eBay orders (traceable by order id,
and no per-order chat URL exists) and bulk-import children (they inherit the batch's proof).
Editing existing records is never blocked — otherwise the AI could not touch any of the
items that predate this.

## Proof files

`proofAttachments[]` holds chat screenshots, payment confirmations, shipping labels and
receipts, in a **Proof / Nachweise** section on the item card — separate from the product
photo gallery. Drag & drop, file picker, or paste a screenshot straight from the clipboard.

Only Firebase Storage URLs are stored; `addProofAttachment` refuses data URLs, because
these live inside the item document and inline images would blow past Firestore's 1 MB
limit. Older single-file fields (`kleinanzeigenChatImage`, `ebayOrderScreenshotUrl`,
`receiptUrl`) appear in the same gallery marked **Legacy**, without migration.

The Finanzamt workbook gained three columns: `Quelle_Link`, `Nachweise_Anzahl`,
`Nachweise_Links`.

## Deferred name reveal (Direkt Kaufen)

Kleinanzeigen only shows a buyer's real name after the shipping label is bought, so a deal
can be recorded with a nickname: set `counterpartyNameConfirmed: false`. Those rows get a
**Name pending** chip and a filter chip in the inbox. When the name appears, re-read the
chat and call `updateDeal(id, { counterparty, counterpartyNameConfirmed: true })` — it
updates in place, no duplicate. This is why a `sourceChatUrl` is mandatory for such rows:
it is the only way back to check.

## Stale-deal reminders

`utils/staleDeals.ts` flags anything unresolved for 3+ days:

- a purchase paid for but not marked received,
- a Direkt Kaufen sale the buyer never confirmed (payout still held),
- a counterparty name that never got revealed.

It is a pure function over plain records — no React, no storage — so a server cron could
call it unchanged later. Today `hooks/useInboxAlerts.ts` runs it once per calendar day in
the panel and renders the list at the top of the Inbox with a direct link to each chat,
plus a **⚠ N** badge on the Inventory nav item.

