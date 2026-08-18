/**
 * Turning a resolved inbox transaction into inventory.
 *
 * Buy  → a new Active inventory item carrying every field collected in the inbox.
 * Sell → the linked item moves to Sold with the sale details filled in.
 *
 * Pure functions so the mapping is testable without React or storage.
 */

import { ItemStatus, type InventoryItem, type ProofAttachment } from '../types';
import type { PendingTransaction } from '../services/pendingTransactions';
import { buildCostOrigin } from './costOrigin';

/** Shipping the seller covered is deducted from profit but not from the paid amount. */
function shippingFields(tx: PendingTransaction): Partial<InventoryItem> {
  if (!tx.sellerPaidShipping) return {};
  return {
    sellerPaidShipping: true,
    sellerShippingAmount: tx.shippingAmount,
  };
}

/** Union of the item's own proof and the deal's, de-duplicated by file URL. */
function mergeProofs(
  itemProofs: ProofAttachment[] | undefined,
  txProofs: ProofAttachment[] | undefined
): ProofAttachment[] | undefined {
  if (!itemProofs?.length) return txProofs;
  if (!txProofs?.length) return itemProofs;
  const seen = new Set(itemProofs.map((p) => p.fileUrl));
  return [...itemProofs, ...txProofs.filter((p) => !seen.has(p.fileUrl))];
}

export interface BuildItemOptions {
  /** Id for the new row; caller supplies so it can be logged/linked. */
  itemId: string;
  /** Defaults to the transaction date. */
  receiveDate?: string;
  category?: string;
  subCategory?: string;
}

/** Build the Active inventory item for a completed purchase. */
export function buildItemFromPurchaseTransaction(
  tx: PendingTransaction,
  options: BuildItemOptions
): InventoryItem {
  return {
    id: options.itemId,
    name: tx.title,
    buyPrice: tx.amount ?? 0,
    buyDate: options.receiveDate || tx.date,
    category: options.category || tx.category || 'Misc',
    subCategory: options.subCategory || tx.subCategory || '',
    status: ItemStatus.IN_STOCK,
    comment1: '',
    comment2: '',
    vendor: tx.counterparty,
    platformBought: tx.platform,
    buyPaymentType: tx.paymentType,
    kleinanzeigenBuyChatUrl: tx.chatUrl,
    // Source links travel with the deal so the item stays verifiable after finalizing.
    sourceChatUrl: tx.sourceChatUrl || tx.chatUrl,
    sourceOrderUrl: tx.sourceOrderUrl || tx.listingUrl,
    counterpartyProfileUrl: tx.counterpartyProfileUrl,
    externalOrderId: tx.externalOrderId,
    kleinanzeigenSellerProfileUrl: tx.counterpartyProfileUrl,
    // Attribution travels with the record so the item shows the same provenance.
    source: tx.source,
    lastModifiedBy: tx.lastModifiedBy,
    aiReviewStatus: tx.aiReviewStatus,
    // Evidence must survive the hand-off — it is the tax proof for this purchase.
    proofAttachments: tx.proofAttachments,
    ...shippingFields(tx),
    costOrigin: buildCostOrigin({
      kind: 'inbox_purchase',
      addedAs: `Inbox purchase${tx.platform ? ` · ${tx.platform}` : ''}`,
      lotTotalEur: tx.amount ?? 0,
      allocatedEur: tx.amount ?? 0,
      allocationMethod: 'manual',
      siblings: [{ name: tx.title, allocatedEur: tx.amount ?? 0 }],
      notes: tx.counterparty ? `Seller: ${tx.counterparty}` : undefined,
    }),
  };
}

/** Apply a completed sale onto the existing inventory item. */
export function applySaleTransactionToItem(
  item: InventoryItem,
  tx: PendingTransaction,
  soldDate?: string
): InventoryItem {
  return {
    ...item,
    status: ItemStatus.SOLD,
    sellPrice: tx.amount ?? item.sellPrice,
    sellDate: soldDate || tx.date,
    platformSold: tx.platform,
    paymentType: tx.paymentType,
    kleinanzeigenChatUrl: tx.chatUrl || item.kleinanzeigenChatUrl,
    sourceChatUrl: tx.sourceChatUrl || tx.chatUrl || item.sourceChatUrl,
    sourceOrderUrl: tx.sourceOrderUrl || tx.listingUrl || item.sourceOrderUrl,
    counterpartyProfileUrl: tx.counterpartyProfileUrl || item.counterpartyProfileUrl,
    externalOrderId: tx.externalOrderId || item.externalOrderId,
    customer: tx.counterparty
      ? { ...(item.customer || { address: '' }), name: tx.counterparty }
      : item.customer,
    ...shippingFields(tx),
    source: item.source ?? tx.source,
    lastModifiedBy: tx.lastModifiedBy ?? item.lastModifiedBy,
    aiReviewStatus: tx.aiReviewStatus ?? item.aiReviewStatus,
    proofAttachments: mergeProofs(item.proofAttachments, tx.proofAttachments),
  };
}

/**
 * Best-effort match of a sale transaction to an in-stock item, used when the user never
 * linked one explicitly. Exact name match first, then a case-insensitive contains.
 */
export function findItemForSaleTransaction(
  tx: PendingTransaction,
  items: InventoryItem[]
): InventoryItem | undefined {
  if (tx.linkedItemId) return items.find((i) => i.id === tx.linkedItemId);
  const title = tx.title.trim().toLowerCase();
  if (!title) return undefined;
  const inStock = items.filter((i) => i.status === ItemStatus.IN_STOCK);
  return (
    inStock.find((i) => i.name.trim().toLowerCase() === title) ||
    inStock.find((i) => i.name.toLowerCase().includes(title) || title.includes(i.name.toLowerCase()))
  );
}
