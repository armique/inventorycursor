/**
 * Inbox methods on `window.deinventory.ai`.
 *
 * Inbox rows have no form of their own to drive, so the assistant writes them through
 * this narrow entry point instead. Each call creates the transaction *and* an audit
 * entry with the full field set, so it shows up in "Done by AI" like any other change.
 *
 *   window.deinventory.ai.addDeal({
 *     direction: 'buy',
 *     platform: 'kleinanzeigen.de',
 *     title: 'RTX 3060 12GB',
 *     counterparty: 'Felix Matthes',
 *     amount: 180,
 *     paymentType: 'Kleinanzeigen (Direkt Kaufen)',
 *     date: '2026-07-23',
 *   })
 */

import type { AiActionDiffEntry, ProofAttachmentType } from '../types';
import { MissingSourceLinkError, requiresSourceChatUrl } from '../utils/sourceLinks';
import { addProofAttachment } from '../utils/proofAttachments';
import { recordAiActions } from './aiActionLog';
import { extendAiBridge, getAiSessionContext, isAiSessionActive } from './aiSession';
import {
  createPendingTransaction,
  loadPendingTransactions,
  updatePendingTransaction,
  type NewPendingTransaction,
  type PendingTransaction,
} from './pendingTransactions';

/** Fields worth showing in the audit feed for an inbox row. */
const AUDITED_FIELDS: (keyof PendingTransaction)[] = [
  'title',
  'direction',
  'platform',
  'stage',
  'counterparty',
  'counterpartyNameConfirmed',
  'amount',
  'paymentType',
  'date',
  'sellerPaidShipping',
  'shippingAmount',
  'sourceChatUrl',
  'sourceOrderUrl',
  'counterpartyProfileUrl',
  'externalOrderId',
  'chatUrl',
  'listingUrl',
  'note',
  'category',
  'subCategory',
  'linkedItemId',
];

function diffForCreate(tx: PendingTransaction): AiActionDiffEntry[] {
  return AUDITED_FIELDS.flatMap((field) => {
    const value = tx[field];
    if (value === undefined || value === null || value === '') return [];
    return [{ field: field as string, oldValue: null, newValue: value as unknown }];
  });
}

function diffForUpdate(
  before: PendingTransaction,
  after: PendingTransaction
): AiActionDiffEntry[] {
  return AUDITED_FIELDS.flatMap((field) => {
    const oldValue = before[field] ?? null;
    const newValue = after[field] ?? null;
    if (oldValue === newValue) return [];
    return [{ field: field as string, oldValue: oldValue as unknown, newValue: newValue as unknown }];
  });
}

export interface AiAddDealInput extends Omit<NewPendingTransaction, 'date' | 'source'> {
  /** YYYY-MM-DD — defaults to today. */
  date?: string;
  /** Overrides the session context for this one row. */
  sourceContext?: string;
}

/**
 * Create an inbox deal attributed to the assistant.
 *
 * Refuses to create a record with no way back to the source — the whole point of the
 * paper trail. eBay orders are exempt (they carry ids, and the order URL is derived).
 */
export function aiAddDeal(input: AiAddDealInput): PendingTransaction {
  const hasLink = Boolean(input.sourceChatUrl || input.chatUrl || input.sourceOrderUrl || input.listingUrl);
  if (!hasLink && requiresSourceChatUrl(input)) {
    throw new MissingSourceLinkError(`Deal “${input.title}”`);
  }
  const sourceContext = input.sourceContext || getAiSessionContext() || undefined;
  const tx = createPendingTransaction({
    ...input,
    date: input.date || new Date().toISOString().slice(0, 10),
    source: 'ai',
    lastModifiedBy: 'ai',
    aiReviewStatus: 'unreviewed',
    sourceContext,
  });
  recordAiActions([
    {
      actionType: 'inbox_created',
      targetKind: 'inbox',
      itemId: tx.id,
      itemName: tx.title,
      diff: diffForCreate(tx),
      sourceContext,
    },
  ]);
  return tx;
}

/** Update an inbox deal attributed to the assistant. Returns null for unknown ids. */
export function aiUpdateDeal(
  id: string,
  patch: Partial<Omit<PendingTransaction, 'id' | 'createdAt'>> & { sourceContext?: string }
): PendingTransaction | null {
  const before = loadPendingTransactions().find((t) => t.id === id);
  if (!before) return null;
  const sourceContext = patch.sourceContext || getAiSessionContext() || undefined;
  const after = updatePendingTransaction(id, {
    ...patch,
    lastModifiedBy: 'ai',
    aiReviewStatus: 'unreviewed',
    sourceContext,
  });
  if (!after) return null;
  const diff = diffForUpdate(before, after);
  if (diff.length) {
    recordAiActions([
      {
        actionType: 'inbox_updated',
        targetKind: 'inbox',
        itemId: after.id,
        itemName: after.title,
        diff,
        sourceContext,
      },
    ]);
  }
  return after;
}

/**
 * Attach a proof file the assistant captured (e.g. a screenshot of the chat at the moment
 * payment was confirmed). The file must already be uploaded — the bridge stores links, not
 * bytes, so the record never carries a base64 blob into Firestore.
 */
export function aiAddDealProof(
  id: string,
  input: { type: ProofAttachmentType; fileUrl: string; fileName?: string; note?: string }
): PendingTransaction | null {
  const before = loadPendingTransactions().find((t) => t.id === id);
  if (!before) return null;
  const next = addProofAttachment(before.proofAttachments, { ...input, uploadedBy: 'ai' });
  const after = updatePendingTransaction(id, { proofAttachments: next, lastModifiedBy: 'ai' });
  if (!after) return null;
  recordAiActions([
    {
      actionType: 'inbox_updated',
      targetKind: 'inbox',
      itemId: after.id,
      itemName: after.title,
      diff: [
        {
          field: 'proofAttachments',
          oldValue: `${before.proofAttachments?.length || 0} file(s)`,
          newValue: `${next.length} file(s) · ${input.type}`,
        },
      ],
      sourceContext: getAiSessionContext() || undefined,
    },
  ]);
  return after;
}

/** Register the inbox methods on the bridge. Called once from the panel shell. */
export function installAiInboxBridge(): void {
  extendAiBridge({
    addDeal: (input: AiAddDealInput) => {
      if (!isAiSessionActive()) {
        throw new Error('Call beginSession({ context }) before writing — edits must be attributable.');
      }
      return aiAddDeal(input);
    },
    updateDeal: (id: string, patch: Parameters<typeof aiUpdateDeal>[1]) => {
      if (!isAiSessionActive()) {
        throw new Error('Call beginSession({ context }) before writing — edits must be attributable.');
      }
      return aiUpdateDeal(id, patch);
    },
    addDealProof: (id: string, input: Parameters<typeof aiAddDealProof>[1]) => {
      if (!isAiSessionActive()) {
        throw new Error('Call beginSession({ context }) before writing — edits must be attributable.');
      }
      return aiAddDealProof(id, input);
    },
    listDeals: () => loadPendingTransactions(),
  });
}
