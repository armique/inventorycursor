/**
 * Verify the 3-day stale-deal rules: which deals nag, which stay quiet, the wording, and
 * that every nudge carries a link back to the source.
 * Run: npx tsx scripts/verify-stale-deals.ts
 */
import assert from 'node:assert/strict';
import type { EbayPurchaseRecord } from '../services/ebayPurchaseIndex';
import type { PendingTransaction } from '../services/pendingTransactions';
import { countStaleDeals, findStaleDeals, formatStaleKind, STALE_AFTER_DAYS } from '../utils/staleDeals';

const NOW = Date.parse('2026-07-29T12:00:00Z');
const KA_CHAT = 'https://www.kleinanzeigen.de/m-nachrichten.html?conversationId=12345';

function tx(overrides: Partial<PendingTransaction> = {}): PendingTransaction {
  return {
    id: 'ptx-1',
    platform: 'kleinanzeigen.de',
    direction: 'buy',
    stage: 'awaiting_confirmation',
    title: 'RTX 3060 12GB',
    counterparty: 'Felix Matthes',
    amount: 180,
    date: '2026-07-23', // 6 days before NOW
    sourceChatUrl: KA_CHAT,
    createdAt: '2026-07-23T10:00:00.000Z',
    updatedAt: '2026-07-23T10:00:00.000Z',
    ...overrides,
  };
}

function purchase(overrides: Partial<EbayPurchaseRecord> = {}): EbayPurchaseRecord {
  return {
    lineKey: 'ord-1-tx-1',
    orderId: '01-14946-82253',
    title: 'Intel Core i5-12400F',
    sellerUsername: 'cpu_dealer',
    creationDate: '2026-07-20',
    quantity: 1,
    unitPrice: 95,
    totalPaid: 99,
    sources: ['api'],
    importedAt: '2026-07-21T08:00:00.000Z',
    disposition: 'pending',
    purchaseType: 'unclassified',
    ...overrides,
  };
}

assert.equal(STALE_AFTER_DAYS, 3);

// --- purchase paid but never received ---
{
  const [deal, ...rest] = findStaleDeals([tx()], [], NOW);
  assert.equal(rest.length, 0);
  assert.equal(deal.kind, 'purchase_not_received');
  assert.equal(deal.days, 6);
  assert.equal(deal.key, 'tx:ptx-1');
  assert.equal(deal.chatUrl, KA_CHAT, 'every nudge links back to the chat');
  assert.match(deal.message, /Felix Matthes/);
  assert.match(deal.message, /6 days/);
}

// --- threshold is "3 or more days", so day 2 stays quiet and day 3 nags ---
{
  assert.deepEqual(findStaleDeals([tx({ date: '2026-07-27' })], [], NOW), [], '2 days — too early');
  const onDayThree = findStaleDeals([tx({ date: '2026-07-26' })], [], NOW);
  assert.equal(onDayThree.length, 1);
  assert.equal(onDayThree[0].days, 3);
}

// --- confirmed / finalized / cancelled deals stay quiet ---
assert.deepEqual(findStaleDeals([tx({ itemInHandAt: '2026-07-24T10:00:00.000Z' })], [], NOW), []);
assert.deepEqual(findStaleDeals([tx({ stage: 'finalized' })], [], NOW), []);
assert.deepEqual(findStaleDeals([tx({ stage: 'cancelled' })], [], NOW), []);
assert.deepEqual(findStaleDeals([tx({ stage: 'pending' })], [], NOW), [], 'not settled yet — nothing to chase');

// --- Direkt Kaufen sale: buyer never confirmed, payout still held ---
{
  const [deal] = findStaleDeals(
    [tx({ direction: 'sell', counterparty: 'Jana K.', paymentType: 'Kleinanzeigen (Direkt Kaufen)' })],
    [],
    NOW
  );
  assert.equal(deal.kind, 'sale_not_confirmed');
  assert.match(deal.message, /has not confirmed receipt/);
  assert.match(deal.message, /Jana K\./);
}

// --- name never revealed is its own nudge, on top of the money one ---
{
  const deals = findStaleDeals([tx({ direction: 'sell', counterpartyNameConfirmed: false })], [], NOW);
  const kinds = deals.map((d) => d.kind).sort();
  assert.deepEqual(kinds, ['name_not_revealed', 'sale_not_confirmed']);
  const nameDeal = deals.find((d) => d.kind === 'name_not_revealed')!;
  assert.match(nameDeal.message, /shipping label/);
}

// --- confirmed names never trigger the name nudge ---
assert.equal(
  findStaleDeals([tx({ counterpartyNameConfirmed: true })], [], NOW).filter(
    (d) => d.kind === 'name_not_revealed'
  ).length,
  0
);

// --- eBay orders still sitting in Pending count as "did this arrive?" ---
{
  const [deal] = findStaleDeals([], [purchase()], NOW);
  assert.equal(deal.kind, 'purchase_not_received');
  assert.equal(deal.key, 'ebay:ord-1-tx-1');
  assert.equal(deal.days, 9);
  assert.match(deal.message, /eBay order/);
  assert.equal(
    deal.chatUrl,
    'https://www.ebay.de/mesh/ord/details?orderid=01-14946-82253',
    'derived order link, since eBay has no chat URL'
  );
}
assert.deepEqual(findStaleDeals([], [purchase({ disposition: 'inventory' })], NOW), []);
assert.deepEqual(findStaleDeals([], [purchase({ disposition: 'skipped' })], NOW), []);

// --- longest-waiting first, and both sources merge ---
{
  const deals = findStaleDeals([tx()], [purchase()], NOW);
  assert.equal(deals.length, 2);
  assert.deepEqual(deals.map((d) => d.days), [9, 6]);
  assert.equal(countStaleDeals([tx()], [purchase()], NOW), 2);
}

// --- labels ---
assert.equal(formatStaleKind('purchase_not_received'), 'Not received');
assert.equal(formatStaleKind('sale_not_confirmed'), 'Not confirmed');
assert.equal(formatStaleKind('name_not_revealed'), 'Name pending');

console.log('verify-stale-deals: ok');
