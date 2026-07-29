/**
 * Resolving "where did this deal happen" into clickable links.
 *
 * Records written before the generic `SourceLinks` fields existed still carry
 * platform-specific ones (`kleinanzeigenChatUrl`, `ebayOrderId`, `ebayUsername`, …), and
 * eBay never stored a URL at all — only ids. So instead of migrating data, every consumer
 * goes through `resolveSourceLinks`, which prefers the explicit field and otherwise
 * derives the link. Old rows get working links for free.
 */

import type { InventoryItem, SourceLinks } from '../types';
import type { PendingTransaction } from '../services/pendingTransactions';

export type SourceLinkKind = 'chat' | 'order' | 'profile';

export interface ResolvedSourceLink {
  kind: SourceLinkKind;
  url: string;
  label: string;
  /** Tooltip — says where the link came from when it was derived rather than stored. */
  title: string;
}

export interface ResolvedSourceLinks {
  chat?: ResolvedSourceLink;
  order?: ResolvedSourceLink;
  profile?: ResolvedSourceLink;
  /** Convenience list in display order, empty when nothing is known. */
  list: ResolvedSourceLink[];
  externalOrderId?: string;
}

function isUsableUrl(value?: string): value is string {
  if (!value) return false;
  const v = value.trim();
  return v.startsWith('http://') || v.startsWith('https://');
}

/** eBay order detail page for a buyer/seller order number. */
export function buildEbayOrderUrl(orderId?: string): string | undefined {
  const id = orderId?.trim();
  if (!id) return undefined;
  return `https://www.ebay.de/mesh/ord/details?orderid=${encodeURIComponent(id)}`;
}

/** eBay listing page by item id (works for buyer-side history too). */
export function buildEbayItemUrl(itemId?: string): string | undefined {
  const id = itemId?.trim();
  if (!id) return undefined;
  return `https://www.ebay.de/itm/${encodeURIComponent(id)}`;
}

/** eBay member profile page. */
export function buildEbayProfileUrl(username?: string): string | undefined {
  const name = username?.trim();
  if (!name) return undefined;
  return `https://www.ebay.de/usr/${encodeURIComponent(name)}`;
}

/** eBay message thread for one order — the closest thing eBay has to a chat link. */
export function buildEbayMessagesUrl(): string {
  return 'https://mesg.ebay.de/mesgweb/ViewMessages/0';
}

function link(
  kind: SourceLinkKind,
  url: string | undefined,
  label: string,
  title: string
): ResolvedSourceLink | undefined {
  return isUsableUrl(url) ? { kind, url, label, title } : undefined;
}

/** Shape both items and inbox transactions can be read through. */
export interface SourceLinkSubject extends SourceLinks {
  ebayOrderId?: string;
  ebayItemId?: string;
  ebayListingId?: string;
  ebayUsername?: string;
  kleinanzeigenChatUrl?: string;
  kleinanzeigenBuyChatUrl?: string;
  kleinanzeigenSellerProfileUrl?: string;
  kleinanzeigenListingUrl?: string;
  /** Sales look at the sale chat first, purchases at the buy chat. */
  preferBuySide?: boolean;
}

export function resolveSourceLinks(subject: SourceLinkSubject): ResolvedSourceLinks {
  const buyFirst = subject.preferBuySide !== false;
  const kaChat = buyFirst
    ? subject.kleinanzeigenBuyChatUrl || subject.kleinanzeigenChatUrl
    : subject.kleinanzeigenChatUrl || subject.kleinanzeigenBuyChatUrl;

  const chat =
    link('chat', subject.sourceChatUrl, 'Chat', 'Open the conversation this deal came from') ||
    link('chat', kaChat, 'Chat', 'Open the Kleinanzeigen conversation');

  const order =
    link('order', subject.sourceOrderUrl, 'Order', 'Open the order / listing') ||
    link('order', subject.kleinanzeigenListingUrl, 'Listing', 'Open the Kleinanzeigen listing') ||
    link(
      'order',
      buildEbayItemUrl(subject.ebayItemId || subject.ebayListingId),
      'Listing',
      'Open the eBay listing (built from the item id)'
    ) ||
    link(
      'order',
      buildEbayOrderUrl(subject.externalOrderId || subject.ebayOrderId),
      'Order',
      'Open the eBay order (built from the order number)'
    );

  const profile =
    link('profile', subject.counterpartyProfileUrl, 'Profile', 'Open the counterparty profile') ||
    link(
      'profile',
      subject.kleinanzeigenSellerProfileUrl,
      'Profile',
      'Open the Kleinanzeigen seller profile'
    ) ||
    link(
      'profile',
      buildEbayProfileUrl(subject.ebayUsername),
      'Profile',
      'Open the eBay member profile (built from the username)'
    );

  return {
    chat,
    order,
    profile,
    list: [chat, order, profile].filter((l): l is ResolvedSourceLink => Boolean(l)),
    externalOrderId: subject.externalOrderId || subject.ebayOrderId,
  };
}

export function resolveItemSourceLinks(item: InventoryItem): ResolvedSourceLinks {
  // A sold item's story is the sale chat; anything still in stock points at the purchase.
  const preferBuySide = !item.sellDate && !item.kleinanzeigenChatUrl;
  return resolveSourceLinks({ ...item, preferBuySide });
}

export function resolveTransactionSourceLinks(tx: PendingTransaction): ResolvedSourceLinks {
  return resolveSourceLinks({
    sourceChatUrl: tx.sourceChatUrl || tx.chatUrl,
    sourceOrderUrl: tx.sourceOrderUrl || tx.listingUrl,
    counterpartyProfileUrl: tx.counterpartyProfileUrl,
    externalOrderId: tx.externalOrderId,
  });
}

/** True when nothing links this record back to a source. */
export function hasNoSourceLink(subject: SourceLinkSubject): boolean {
  return resolveSourceLinks(subject).list.length === 0;
}

/**
 * Platforms the assistant is allowed to create records for without a chat link.
 *
 * eBay orders arrive through the API with only ids — no conversation URL exists — and the
 * order link is derived from the order number anyway, so demanding a chat URL there would
 * block a flow that is already fully traceable.
 */
export function requiresSourceChatUrl(subject: {
  platform?: string;
  externalOrderId?: string;
  ebayOrderId?: string;
  bulkImportId?: string;
}): boolean {
  if (subject.platform === 'ebay.de') return false;
  if (subject.externalOrderId || subject.ebayOrderId) return false;
  // Bulk-import children inherit their proof from the batch record.
  if (subject.bulkImportId) return false;
  return true;
}

export class MissingSourceLinkError extends Error {
  constructor(what: string) {
    super(
      `${what} needs a source link. Pass sourceChatUrl (or sourceOrderUrl) so the deal can be verified later.`
    );
    this.name = 'MissingSourceLinkError';
  }
}
