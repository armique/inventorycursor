/**
 * Deals that have been sitting unresolved too long.
 *
 * Deliberately a pure function over plain records — no React, no storage, no browser. The
 * panel runs it once a day on load; a server cron could call the exact same function
 * later without rewriting the rules.
 */

import type { EbayPurchaseRecord } from '../services/ebayPurchaseIndex';
import type { PendingTransaction } from '../services/pendingTransactions';
import { daysSince } from '../services/pendingTransactions';
import { resolveSourceLinks, resolveTransactionSourceLinks } from './sourceLinks';

/** How long a deal may sit unresolved before it is worth a nudge. */
export const STALE_AFTER_DAYS = 3;

export type StaleDealKind =
  /** Paid for, not marked as received. */
  | 'purchase_not_received'
  /** Sold and shipped, buyer never confirmed → payout still held. */
  | 'sale_not_confirmed'
  /** Counterparty is still a nickname — the shipping label may not have been bought. */
  | 'name_not_revealed';

export interface StaleDeal {
  /** Matches the inbox entry key so the UI can scroll to the row. */
  key: string;
  kind: StaleDealKind;
  title: string;
  counterparty?: string;
  days: number;
  /** Ready-to-show sentence. */
  message: string;
  /** Direct link to the conversation, when one is known. */
  chatUrl?: string;
}

function nameOf(counterparty?: string): string {
  return counterparty?.trim() || 'the counterparty';
}

/**
 * Build the nudge list.
 *
 * eBay purchases count too: an order still sitting in `pending` days after it was placed
 * is exactly the "did this ever arrive?" case, and it is the most common one.
 */
export function findStaleDeals(
  transactions: PendingTransaction[],
  purchases: EbayPurchaseRecord[] = [],
  now = Date.now()
): StaleDeal[] {
  const out: StaleDeal[] = [];

  for (const tx of transactions) {
    if (tx.stage === 'finalized' || tx.stage === 'cancelled') continue;
    const links = resolveTransactionSourceLinks(tx);
    const chatUrl = links.chat?.url || links.order?.url;
    const days = daysSince(tx.date, now);
    const who = nameOf(tx.counterparty);

    // A name that never showed up is worth flagging regardless of the money side.
    if (tx.counterpartyNameConfirmed === false && days >= STALE_AFTER_DAYS) {
      out.push({
        key: `tx:${tx.id}`,
        kind: 'name_not_revealed',
        title: tx.title,
        counterparty: tx.counterparty,
        days,
        message: `The buyer's name for “${tx.title}” is still hidden after ${days} days — check whether the shipping label was bought`,
        chatUrl,
      });
    }

    if (days < STALE_AFTER_DAYS) continue;
    const settled = tx.stage === 'awaiting_confirmation' || tx.stage === 'likely_complete';
    if (!settled || tx.itemInHandAt) continue;

    if (tx.direction === 'buy') {
      out.push({
        key: `tx:${tx.id}`,
        kind: 'purchase_not_received',
        title: tx.title,
        counterparty: tx.counterparty,
        days,
        message: `Check the order from ${who} — paid ${days} days ago, “${tx.title}” not marked as received`,
        chatUrl,
      });
    } else {
      out.push({
        key: `tx:${tx.id}`,
        kind: 'sale_not_confirmed',
        title: tx.title,
        counterparty: tx.counterparty,
        days,
        message: `${who} has not confirmed receipt of “${tx.title}” for ${days} days — it may be worth messaging them`,
        chatUrl,
      });
    }
  }

  for (const p of purchases) {
    if (p.disposition !== 'pending') continue;
    const date = p.creationDate || p.importedAt.slice(0, 10);
    const days = daysSince(date, now);
    if (days < STALE_AFTER_DAYS) continue;
    const links = resolveSourceLinks({
      externalOrderId: p.orderId,
      ebayUsername: p.sellerUsername,
    });
    out.push({
      key: `ebay:${p.lineKey}`,
      kind: 'purchase_not_received',
      title: p.title,
      counterparty: p.sellerUsername,
      days,
      message: `Check the eBay order from ${nameOf(p.sellerUsername)} — ordered ${days} days ago, “${p.title}” not confirmed as received`,
      chatUrl: links.order?.url,
    });
  }

  // Longest-waiting first — those are the ones actually at risk.
  return out.sort((a, b) => b.days - a.days);
}

export function countStaleDeals(
  transactions: PendingTransaction[],
  purchases: EbayPurchaseRecord[] = [],
  now = Date.now()
): number {
  return findStaleDeals(transactions, purchases, now).length;
}

const KIND_LABELS: Record<StaleDealKind, string> = {
  purchase_not_received: 'Not received',
  sale_not_confirmed: 'Not confirmed',
  name_not_revealed: 'Name pending',
};

export function formatStaleKind(kind: StaleDealKind): string {
  return KIND_LABELS[kind];
}
