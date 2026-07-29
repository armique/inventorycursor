/**
 * Verify the unified pending inbox: stage rules per payment method, bucketing of both
 * sources, and that eBay records keep their existing Pending/Received/Ignored meaning.
 * Run: npx tsx scripts/verify-inbox-entries.ts
 */
import assert from 'node:assert/strict';
import type { EbayPurchaseRecord } from '../services/ebayPurchaseIndex';
import {
  daysSince,
  initialStageFor,
  isEscrowPayment,
  isImmediatePayment,
  needsSoftReminder,
  type PendingTransaction,
} from '../services/pendingTransactions';
import {
  bucketOf,
  buildInboxEntries,
  countInboxBuckets,
  filterInboxEntries,
  toInboxEntryFromEbay,
  toInboxEntryFromTransaction,
} from '../utils/inboxEntries';

function purchase(overrides: Partial<EbayPurchaseRecord> = {}): EbayPurchaseRecord {
  return {
    lineKey: 'order-1-tx-1',
    orderId: 'order-1',
    title: 'Kingston Fury 16GB',
    sellerUsername: 'hardware_shop',
    creationDate: '2026-07-20',
    quantity: 1,
    unitPrice: 20,
    totalPaid: 22,
    sources: ['api'],
    importedAt: '2026-07-21T10:00:00.000Z',
    disposition: 'pending',
    purchaseType: 'unclassified',
    ...overrides,
  };
}

function tx(overrides: Partial<PendingTransaction> = {}): PendingTransaction {
  return {
    id: 'ptx-1',
    platform: 'kleinanzeigen.de',
    direction: 'buy',
    stage: 'pending',
    title: 'RTX 3060 12GB',
    counterparty: 'Felix Matthes',
    amount: 180,
    date: '2026-07-23',
    createdAt: '2026-07-23T10:00:00.000Z',
    updatedAt: '2026-07-23T10:00:00.000Z',
    ...overrides,
  };
}

// --- payment classification ---
assert.equal(isEscrowPayment('Kleinanzeigen (Direkt Kaufen)'), true);
assert.equal(isEscrowPayment('Kleinanzeigen (Cash)'), false);
assert.equal(isImmediatePayment('Kleinanzeigen (Paypal)'), true);
assert.equal(isImmediatePayment('Kleinanzeigen (Wire Transfer)'), true);
assert.equal(isImmediatePayment('Kleinanzeigen (Direkt Kaufen)'), false);

// --- initial stage: Direkt Kaufen is never treated as done on payment ---
assert.equal(initialStageFor('Kleinanzeigen (Direkt Kaufen)'), 'awaiting_confirmation');
assert.equal(initialStageFor('Kleinanzeigen (Cash)'), 'likely_complete');
assert.equal(initialStageFor('Paypal'), 'likely_complete');
assert.equal(initialStageFor('Kleinanzeigen (Cash)', false), 'pending', 'unpaid stays pending');
assert.equal(initialStageFor(undefined), 'pending');

// --- Direkt Kaufen buy: awaiting, escrow flagged, no soft reminder ---
{
  const entry = toInboxEntryFromTransaction(
    tx({ paymentType: 'Kleinanzeigen (Direkt Kaufen)', stage: 'awaiting_confirmation' })
  );
  assert.equal(entry.escrowHeld, true);
  assert.equal(entry.softReminder, false);
  assert.equal(bucketOf(entry), 'awaiting');
  assert.equal(entry.actionLabel, 'Confirm receipt');
  assert.match(entry.statusLabel, /awaiting receipt/i);
}

// --- Direkt Kaufen sell: waits for the buyer's confirmation and payout ---
{
  const entry = toInboxEntryFromTransaction(
    tx({
      direction: 'sell',
      paymentType: 'Kleinanzeigen (Direkt Kaufen)',
      stage: 'awaiting_confirmation',
    })
  );
  assert.equal(bucketOf(entry), 'awaiting');
  assert.notEqual(entry.stage, 'finalized', 'payout not received yet — never final');
  assert.match(entry.statusLabel, /payout/i);
}

// --- Cash: likely complete immediately, soft toggle, never blocking ---
{
  const cash = tx({ paymentType: 'Kleinanzeigen (Cash)', stage: 'likely_complete' });
  const entry = toInboxEntryFromTransaction(cash);
  assert.equal(entry.escrowHeld, false);
  assert.equal(bucketOf(entry), 'awaiting');
  assert.match(entry.statusLabel, /likely complete/i);
  assert.equal(entry.actionLabel, 'Item in stock');

  const confirmed = toInboxEntryFromTransaction({ ...cash, itemInHandAt: '2026-07-24T09:00:00.000Z' });
  assert.match(confirmed.statusLabel, /confirmed/i);
  assert.equal(confirmed.actionLabel, 'Add to inventory');
  assert.equal(confirmed.softReminder, false, 'confirmed rows never nag');
}

// --- soft reminder only after the threshold, and only while unconfirmed ---
{
  const base = tx({ paymentType: 'Kleinanzeigen (Cash)', stage: 'likely_complete', date: '2026-07-23' });
  const twoDaysLater = Date.parse('2026-07-25T12:00:00Z');
  const fiveDaysLater = Date.parse('2026-07-28T12:00:00Z');
  assert.equal(daysSince('2026-07-23', fiveDaysLater), 5);
  assert.equal(needsSoftReminder(base, twoDaysLater), false);
  assert.equal(needsSoftReminder(base, fiveDaysLater), true);
  assert.equal(
    needsSoftReminder({ ...base, itemInHandAt: '2026-07-24T00:00:00.000Z' }, fiveDaysLater),
    false
  );
  assert.equal(needsSoftReminder({ ...base, stage: 'pending' }, fiveDaysLater), false);
}

// --- eBay records keep their existing three-way meaning ---
{
  const pending = toInboxEntryFromEbay(purchase());
  assert.equal(pending.stage, 'pending');
  assert.equal(bucketOf(pending), 'pending');
  assert.equal(pending.actionLabel, 'Confirm received');
  assert.equal(pending.direction, 'buy');
  assert.equal(pending.platform, 'ebay.de');
  assert.equal(pending.amount, 22);
  assert.equal(pending.key, 'ebay:order-1-tx-1');

  const received = toInboxEntryFromEbay(
    purchase({ disposition: 'inventory', inventoryItemId: 'item-9' })
  );
  assert.equal(bucketOf(received), 'finalized');
  assert.equal(received.linkedItemId, 'item-9');
  assert.equal(received.actionLabel, '');

  const ignored = toInboxEntryFromEbay(purchase({ disposition: 'skipped' }));
  assert.equal(bucketOf(ignored), 'ignored');

  // Non-inventory dispositions resolve too — they must not linger in Pending.
  for (const d of ['expense', 'filament', 'personal'] as const) {
    assert.equal(bucketOf(toInboxEntryFromEbay(purchase({ disposition: d }))), 'finalized');
  }
}

// --- merged list: both sources, newest first, ignored hidden from All ---
{
  const entries = buildInboxEntries(
    [purchase(), purchase({ lineKey: 'x-2', disposition: 'skipped', creationDate: '2026-07-10' })],
    [
      tx({ paymentType: 'Kleinanzeigen (Direkt Kaufen)', stage: 'awaiting_confirmation' }),
      tx({ id: 'ptx-2', direction: 'sell', stage: 'finalized', date: '2026-07-01' }),
    ],
    Date.parse('2026-07-24T12:00:00Z')
  );
  assert.equal(entries.length, 4);
  assert.deepEqual(
    entries.map((e) => e.date),
    ['2026-07-23', '2026-07-20', '2026-07-10', '2026-07-01']
  );

  const counts = countInboxBuckets(entries);
  assert.deepEqual(counts, { pending: 1, awaiting: 1, finalized: 1, ignored: 1, all: 3 });

  assert.equal(filterInboxEntries(entries, 'all').length, 3, 'All hides ignored');
  assert.equal(filterInboxEntries(entries, 'pending').length, 1);
  assert.equal(filterInboxEntries(entries, 'awaiting').length, 1);
  assert.equal(filterInboxEntries(entries, 'ignored').length, 1);
}

// --- AI attribution rides along into the inbox view ---
{
  const entry = toInboxEntryFromTransaction(
    tx({ source: 'ai', aiReviewStatus: 'unreviewed', sourceContext: 'KA chat with Felix' })
  );
  assert.equal(entry.source, 'ai');
  assert.equal(entry.aiReviewStatus, 'unreviewed');
  assert.equal(entry.sourceContext, 'KA chat with Felix');
}

console.log('verify-inbox-entries: ok');
