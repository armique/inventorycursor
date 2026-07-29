/**
 * Verify proof attachments: storage-URL-only rule, legacy screenshot fields folded into
 * the same list, de-duplication, and the Finanzamt export formatting.
 * Run: npx tsx scripts/verify-proof-attachments.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem, type ProofAttachment } from '../types';
import {
  addProofAttachment,
  collectProofAttachments,
  formatProofSummary,
  formatProofUrlsForExport,
  isStoredFileUrl,
  removeProofAttachment,
} from '../utils/proofAttachments';

const URL_A = 'https://firebasestorage.googleapis.com/v0/b/x/o/items%2Fu1%2Fi1%2Fproof%2Fa.png';
const URL_B = 'https://firebasestorage.googleapis.com/v0/b/x/o/items%2Fu1%2Fi1%2Fproof%2Fb.pdf';
const LEGACY_CHAT = 'https://firebasestorage.googleapis.com/v0/b/x/o/legacy-chat.png';

function item(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 'i1',
    name: 'RTX 3060',
    buyPrice: 180,
    buyDate: '2026-07-23',
    category: 'Components',
    status: ItemStatus.IN_STOCK,
    comment1: '',
    comment2: '',
    ...overrides,
  };
}

// --- only durable storage URLs are accepted ---
assert.equal(isStoredFileUrl(URL_A), true);
assert.equal(isStoredFileUrl('data:image/png;base64,iVBORw0KG'), false);
assert.equal(isStoredFileUrl(undefined), false);
assert.throws(
  () => addProofAttachment([], { type: 'chat_screenshot', fileUrl: 'data:image/png;base64,AAA' }),
  /uploaded to storage first/,
  'base64 must never reach the record'
);

// --- add / dedupe / remove ---
{
  let list: ProofAttachment[] = addProofAttachment(undefined, {
    type: 'chat_screenshot',
    fileUrl: URL_A,
    fileName: 'chat.png',
    note: 'Chat at the moment payment was confirmed',
  });
  assert.equal(list.length, 1);
  assert.equal(list[0].uploadedBy, 'manual');
  assert.equal(list[0].type, 'chat_screenshot');
  assert.ok(list[0].uploadedAt);

  list = addProofAttachment(list, { type: 'receipt', fileUrl: URL_A });
  assert.equal(list.length, 1, 'same file is not attached twice');

  list = addProofAttachment(list, { type: 'receipt', fileUrl: URL_B, uploadedBy: 'ai' });
  assert.equal(list.length, 2);
  assert.equal(list[1].uploadedBy, 'ai');

  const pruned = removeProofAttachment(list, list[0].id);
  assert.equal(pruned.length, 1);
  assert.equal(pruned[0].fileUrl, URL_B);
}

// --- legacy screenshot fields show up without migration ---
{
  const proofs = collectProofAttachments(item({ kleinanzeigenBuyChatImage: LEGACY_CHAT }));
  assert.equal(proofs.length, 1);
  assert.equal(proofs[0].legacy, true);
  assert.equal(proofs[0].type, 'chat_screenshot');
  assert.equal(proofs[0].legacyField, 'kleinanzeigenBuyChatImage');

  // base64 leftovers in legacy fields are ignored rather than rendered as broken images.
  assert.deepEqual(
    collectProofAttachments(item({ kleinanzeigenBuyChatImage: 'data:image/png;base64,AAA' })),
    []
  );
}

// --- stored attachments come first; a legacy field pointing at the same file is not duplicated ---
{
  const withBoth = item({
    kleinanzeigenBuyChatImage: URL_A,
    proofAttachments: [
      {
        id: 'p1',
        type: 'chat_screenshot',
        fileUrl: URL_A,
        uploadedAt: '2026-07-24T10:00:00.000Z',
        uploadedBy: 'ai',
      },
    ],
  });
  const proofs = collectProofAttachments(withBoth);
  assert.equal(proofs.length, 1);
  assert.equal(proofs[0].legacy, undefined, 'stored entry wins over the legacy field');
  assert.equal(proofs[0].uploadedBy, 'ai');
}

// --- malformed entries are dropped instead of crashing the gallery ---
{
  const messy = item({
    proofAttachments: [
      { id: 'ok', type: 'receipt', fileUrl: URL_B, uploadedAt: '', uploadedBy: 'manual' },
      { id: 'bad', type: 'receipt', fileUrl: 'not-a-url', uploadedAt: '', uploadedBy: 'manual' },
    ] as ProofAttachment[],
  });
  assert.equal(collectProofAttachments(messy).length, 1);
}

// --- export formatting ---
{
  const exported = item({
    kleinanzeigenBuyChatImage: LEGACY_CHAT,
    proofAttachments: [
      { id: 'p1', type: 'receipt', fileUrl: URL_B, uploadedAt: '', uploadedBy: 'manual' },
    ],
  });
  assert.equal(formatProofUrlsForExport(exported), `${URL_B} | ${LEGACY_CHAT}`);
  assert.equal(formatProofSummary(exported), '2 (receipt / rechnung, chat screenshot)');
  assert.equal(formatProofSummary(item()), '', 'no proof → empty cell, not "0"');
  assert.equal(formatProofUrlsForExport(undefined), '');
}

console.log('verify-proof-attachments: ok');
