/**
 * Proof files (Nachweise) attached to a record.
 *
 * Screenshots that predate `proofAttachments` live in dedicated fields
 * (`kleinanzeigenChatImage`, `ebayOrderScreenshotUrl`, `receiptUrl`). Rather than migrate
 * them, `collectProofAttachments` folds them into the same list at read time, so the
 * gallery and the Finanzamt export show everything that was ever attached.
 */

import type { InventoryItem, ProofAttachment, ProofAttachmentType, RecordActor } from '../types';
import type { PendingTransaction } from '../services/pendingTransactions';

export const PROOF_TYPE_LABELS: Record<ProofAttachmentType, string> = {
  chat_screenshot: 'Chat screenshot',
  payment_confirmation: 'Payment confirmation',
  shipping_label: 'Shipping label',
  receipt: 'Receipt / Rechnung',
  other: 'Other',
};

/** Legacy single-file fields, surfaced as read-only proof entries. */
const LEGACY_SOURCES: {
  field: keyof InventoryItem;
  type: ProofAttachmentType;
  note: string;
}[] = [
  { field: 'kleinanzeigenChatImage', type: 'chat_screenshot', note: 'Kleinanzeigen sale chat' },
  { field: 'kleinanzeigenBuyChatImage', type: 'chat_screenshot', note: 'Kleinanzeigen purchase chat' },
  { field: 'ebayOrderScreenshotUrl', type: 'chat_screenshot', note: 'eBay order screenshot' },
  { field: 'receiptUrl', type: 'receipt', note: 'Purchase receipt' },
];

/** Only durable, linkable files belong in the audit trail — not inline data URIs. */
export function isStoredFileUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  return v.startsWith('http://') || v.startsWith('https://');
}

function normalize(raw: unknown): ProofAttachment | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<ProofAttachment>;
  if (!isStoredFileUrl(p.fileUrl)) return null;
  return {
    id: String(p.id || `proof-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    type: (p.type as ProofAttachmentType) || 'other',
    fileUrl: p.fileUrl,
    fileName: p.fileName,
    uploadedAt: p.uploadedAt || new Date().toISOString(),
    uploadedBy: (p.uploadedBy as RecordActor) || 'manual',
    note: p.note,
  };
}

export interface CollectedProof extends ProofAttachment {
  /** Came from a legacy single-file field — shown but not removable from the list. */
  legacy?: boolean;
  /** Legacy field this was derived from, so callers can clear the right one. */
  legacyField?: string;
}

/** Every proof for a record: stored attachments first, then legacy screenshots. */
export function collectProofAttachments(
  record: Partial<InventoryItem> | PendingTransaction | undefined
): CollectedProof[] {
  if (!record) return [];
  const stored = Array.isArray(record.proofAttachments)
    ? record.proofAttachments.map(normalize).filter((p): p is ProofAttachment => Boolean(p))
    : [];
  const seen = new Set(stored.map((p) => p.fileUrl));

  const legacy: CollectedProof[] = [];
  for (const source of LEGACY_SOURCES) {
    const value = (record as Record<string, unknown>)[source.field as string];
    if (!isStoredFileUrl(value) || seen.has(value)) continue;
    seen.add(value);
    legacy.push({
      id: `legacy-${source.field}`,
      type: source.type,
      fileUrl: value,
      uploadedAt: '',
      uploadedBy: 'manual',
      note: source.note,
      legacy: true,
      legacyField: source.field as string,
    });
  }

  return [...stored, ...legacy];
}

export interface NewProofInput {
  type: ProofAttachmentType;
  fileUrl: string;
  fileName?: string;
  uploadedBy?: RecordActor;
  note?: string;
}

/** Append a proof, ignoring duplicates and anything that is not a stored file URL. */
export function addProofAttachment(
  existing: ProofAttachment[] | undefined,
  input: NewProofInput
): ProofAttachment[] {
  if (!isStoredFileUrl(input.fileUrl)) {
    throw new Error('Proof files must be uploaded to storage first — data URLs are not accepted.');
  }
  const list = existing || [];
  if (list.some((p) => p.fileUrl === input.fileUrl)) return list;
  return [
    ...list,
    {
      id: `proof-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: input.type,
      fileUrl: input.fileUrl,
      fileName: input.fileName,
      uploadedAt: new Date().toISOString(),
      uploadedBy: input.uploadedBy || 'manual',
      note: input.note,
    },
  ];
}

export function removeProofAttachment(
  existing: ProofAttachment[] | undefined,
  id: string
): ProofAttachment[] {
  return (existing || []).filter((p) => p.id !== id);
}

/** Flat, export-friendly list of proof URLs for one record. */
export function formatProofUrlsForExport(
  record: Partial<InventoryItem> | undefined,
  separator = ' | '
): string {
  return collectProofAttachments(record)
    .map((p) => p.fileUrl)
    .join(separator);
}

/** Human summary for the export ("2 (chat screenshot, receipt)"). */
export function formatProofSummary(record: Partial<InventoryItem> | undefined): string {
  const list = collectProofAttachments(record);
  if (!list.length) return '';
  const types = Array.from(new Set(list.map((p) => PROOF_TYPE_LABELS[p.type].toLowerCase())));
  return `${list.length} (${types.join(', ')})`;
}
