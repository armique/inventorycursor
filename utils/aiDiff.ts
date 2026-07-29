/**
 * Field-level diffing for the AI audit trail.
 *
 * Only an explicit allow-list of business fields is diffed. Everything else (images,
 * base64 chat screenshots, sync bookkeeping, live marketplace prices, store gallery
 * URLs…) is skipped: those either churn on their own or would blow up the log size,
 * and none of them is something the user needs to review or revert field-by-field.
 */

import type { AiActionDiffEntry, AiActionType, InventoryItem } from '../types';
import { ItemStatus } from '../types';

/** Longest string value kept in a diff — enough for comments, short of screenshot blobs. */
const MAX_VALUE_LENGTH = 400;

/** Cap on per-key spec diffs so a full AI spec fill cannot flood one action. */
const MAX_SPEC_DIFFS = 25;

/** Top-level scalar fields worth an audit entry. */
const TRACKED_FIELDS: (keyof InventoryItem)[] = [
  'name',
  'buyPrice',
  'sellPrice',
  'storePrice',
  'buyDate',
  'sellDate',
  'category',
  'subCategory',
  'status',
  'comment1',
  'comment2',
  'vendor',
  'quantity',
  'platformBought',
  'platformSold',
  'buyPaymentType',
  'paymentType',
  'hasFee',
  'feeAmount',
  'sellerPaidShipping',
  'sellerShippingAmount',
  'hasReceipt',
  'hasOVP',
  'hasIOShield',
  'isDefective',
  'isDraft',
  'usesDifferentialVat',
  'presence',
  'workflowStage',
  'invoiceNumber',
  'ebayUsername',
  'ebayOrderId',
  'kleinanzeigenChatUrl',
  'kleinanzeigenBuyChatUrl',
  'kleinanzeigenSellerProfileUrl',
  'kleinanzeigenListingUrl',
  'giftRecipient',
  'giftRelation',
  'cashOnTop',
  'saleReady',
  'listedOnEbay',
  'listedOnKleinanzeigen',
  'aiDescriptionNote',
];

/** Nested customer fields, diffed individually so buyer data can be reverted per field. */
const CUSTOMER_FIELDS = ['name', 'address', 'phone', 'email'] as const;

const CUSTOMER_PREFIX = 'customer.';
const SPECS_PREFIX = 'specs.';

function normalizeValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > MAX_VALUE_LENGTH ? `${trimmed.slice(0, MAX_VALUE_LENGTH)}…` : trimmed;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  return null;
}

/** Treats null / undefined / '' as the same "empty" so blank-to-blank is not a change. */
function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (isEmpty(a) && isEmpty(b)) return true;
  return a === b;
}

/** Read a diff field path (`name`, `customer.email`, `specs.CPU`) off an item. */
export function readItemField(item: InventoryItem, field: string): unknown {
  if (field.startsWith(CUSTOMER_PREFIX)) {
    const key = field.slice(CUSTOMER_PREFIX.length) as (typeof CUSTOMER_FIELDS)[number];
    return normalizeValue(item.customer?.[key]);
  }
  if (field.startsWith(SPECS_PREFIX)) {
    const key = field.slice(SPECS_PREFIX.length);
    return normalizeValue(item.specs?.[key]);
  }
  return normalizeValue((item as unknown as Record<string, unknown>)[field]);
}

/** Write a diff field path back onto a copy of the item (used by Revert). */
export function writeItemField(item: InventoryItem, field: string, value: unknown): InventoryItem {
  if (field.startsWith(CUSTOMER_PREFIX)) {
    const key = field.slice(CUSTOMER_PREFIX.length);
    const customer = { ...(item.customer || { name: '', address: '' }) } as Record<string, unknown>;
    if (isEmpty(value)) delete customer[key];
    else customer[key] = value;
    const hasAny = Object.values(customer).some((v) => !isEmpty(v));
    return { ...item, customer: hasAny ? (customer as unknown as InventoryItem['customer']) : undefined };
  }
  if (field.startsWith(SPECS_PREFIX)) {
    const key = field.slice(SPECS_PREFIX.length);
    const specs = { ...(item.specs || {}) };
    if (isEmpty(value)) delete specs[key];
    else specs[key] = value as string | number;
    return { ...item, specs };
  }
  const next = { ...item } as unknown as Record<string, unknown>;
  if (isEmpty(value)) delete next[field];
  else next[field] = value;
  return next as unknown as InventoryItem;
}

/**
 * Compare two versions of an item and return the reviewable field changes.
 * `oldItem === undefined` means the item is being created.
 */
export function diffInventoryItems(
  oldItem: InventoryItem | undefined,
  newItem: InventoryItem
): AiActionDiffEntry[] {
  const diff: AiActionDiffEntry[] = [];

  for (const field of TRACKED_FIELDS) {
    const oldValue = oldItem ? readItemField(oldItem, field as string) : null;
    const newValue = readItemField(newItem, field as string);
    if (valuesEqual(oldValue, newValue)) continue;
    // On create, only record fields that actually carry a value.
    if (!oldItem && isEmpty(newValue)) continue;
    diff.push({ field: field as string, oldValue, newValue });
  }

  for (const key of CUSTOMER_FIELDS) {
    const field = `${CUSTOMER_PREFIX}${key}`;
    const oldValue = oldItem ? readItemField(oldItem, field) : null;
    const newValue = readItemField(newItem, field);
    if (valuesEqual(oldValue, newValue)) continue;
    if (!oldItem && isEmpty(newValue)) continue;
    diff.push({ field, oldValue, newValue });
  }

  const specKeys = new Set([
    ...Object.keys(oldItem?.specs || {}),
    ...Object.keys(newItem.specs || {}),
  ]);
  let specDiffs = 0;
  for (const key of specKeys) {
    if (specDiffs >= MAX_SPEC_DIFFS) break;
    const field = `${SPECS_PREFIX}${key}`;
    const oldValue = oldItem ? readItemField(oldItem, field) : null;
    const newValue = readItemField(newItem, field);
    if (valuesEqual(oldValue, newValue)) continue;
    if (!oldItem && isEmpty(newValue)) continue;
    diff.push({ field, oldValue, newValue });
    specDiffs++;
  }

  return diff;
}

const DISPOSED_STATUSES: ItemStatus[] = [ItemStatus.SOLD, ItemStatus.TRADED, ItemStatus.GIFTED];

/**
 * Pick the action type that best describes a change, for the "Done by AI" feed.
 * A single changed field reads as `field_changed`; several read as `item_updated`.
 */
export function classifyAiAction(
  oldItem: InventoryItem | undefined,
  newItem: InventoryItem,
  diff: AiActionDiffEntry[]
): AiActionType {
  if (!oldItem) return 'item_created';
  const statusChanged = diff.some((d) => d.field === 'status');
  if (statusChanged && DISPOSED_STATUSES.includes(newItem.status)) return 'marked_sold';
  if (diff.length > 0 && diff.every((d) => d.field.startsWith(CUSTOMER_PREFIX))) {
    return 'buyer_info_filled';
  }
  return diff.length === 1 ? 'field_changed' : 'item_updated';
}

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  buyPrice: 'Buy price',
  sellPrice: 'Sell price',
  storePrice: 'Store price',
  buyDate: 'Buy date',
  sellDate: 'Sell date',
  category: 'Category',
  subCategory: 'Subcategory',
  status: 'Status',
  comment1: 'Comment',
  comment2: 'Comment 2',
  vendor: 'Vendor',
  quantity: 'Quantity',
  platformBought: 'Bought on',
  platformSold: 'Sold on',
  buyPaymentType: 'Buy payment',
  paymentType: 'Sale payment',
  hasFee: 'Has fee',
  feeAmount: 'Fee',
  sellerPaidShipping: 'Seller paid shipping',
  sellerShippingAmount: 'Shipping',
  hasReceipt: 'Receipt',
  hasOVP: 'OVP',
  hasIOShield: 'IO shield',
  isDefective: 'Defective',
  isDraft: 'Draft',
  usesDifferentialVat: '§25a VAT',
  presence: 'Presence',
  workflowStage: 'Workflow stage',
  invoiceNumber: 'Invoice number',
  ebayUsername: 'eBay buyer',
  ebayOrderId: 'eBay order',
  kleinanzeigenChatUrl: 'KA sale chat',
  kleinanzeigenBuyChatUrl: 'KA buy chat',
  kleinanzeigenSellerProfileUrl: 'KA seller profile',
  kleinanzeigenListingUrl: 'KA listing',
  giftRecipient: 'Gift recipient',
  giftRelation: 'Gift relation',
  cashOnTop: 'Cash on top',
  saleReady: 'Sale ready',
  listedOnEbay: 'Listed on eBay',
  listedOnKleinanzeigen: 'Listed on KA',
  aiDescriptionNote: 'AI note',
  'customer.name': 'Buyer name',
  'customer.address': 'Buyer address',
  'customer.phone': 'Buyer phone',
  'customer.email': 'Buyer email',
};

/** Human label for a diff field path. */
export function formatFieldLabel(field: string): string {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  if (field.startsWith(SPECS_PREFIX)) return `Spec: ${field.slice(SPECS_PREFIX.length)}`;
  if (field.startsWith(CUSTOMER_PREFIX)) return `Buyer ${field.slice(CUSTOMER_PREFIX.length)}`;
  return field;
}

/** Display form for a diff value ("—" for empty). */
export function formatDiffValue(value: unknown): string {
  if (isEmpty(value)) return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

export const AI_DIFF_INTERNALS = { isEmpty, valuesEqual, normalizeValue };
