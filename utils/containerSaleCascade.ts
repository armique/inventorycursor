/**
 * When a sold PC/bundle is tagged with a marketplace (eBay / KA / …), keep every
 * linked part on the same sale platform + payment identity. Pure helpers so
 * SaleModal, quick-pick, bulk edit, and App.handleUpdate share one rule.
 */

import type { InventoryItem, PaymentType, Platform } from '../types';
import { getChildren } from '../services/financialAggregation';
import { isSoldOrTradedOnly } from './itemDisposition';

export type ContainerSaleMeta = {
  platformSold?: Platform;
  paymentType?: PaymentType;
  ebayOrderId?: string;
  ebayUsername?: string;
  ebaySku?: string;
  ebayListingId?: string;
  kleinanzeigenChatUrl?: string;
};

/** Fields that identify *where* the container was sold — copied onto children. */
export function extractContainerSaleMeta(container: InventoryItem): ContainerSaleMeta {
  const meta: ContainerSaleMeta = {};
  if (container.platformSold) meta.platformSold = container.platformSold;
  if (container.paymentType) meta.paymentType = container.paymentType;
  if (container.ebayOrderId?.trim()) meta.ebayOrderId = container.ebayOrderId.trim();
  if (container.ebayUsername?.trim()) meta.ebayUsername = container.ebayUsername.trim();
  if (container.ebaySku?.trim()) meta.ebaySku = container.ebaySku.trim();
  if (container.ebayListingId?.trim()) meta.ebayListingId = container.ebayListingId.trim();
  if (container.kleinanzeigenChatUrl?.trim()) {
    meta.kleinanzeigenChatUrl = container.kleinanzeigenChatUrl.trim();
  }
  return meta;
}

export function containerSaleMetaHasValue(meta: ContainerSaleMeta): boolean {
  return Boolean(meta.platformSold || meta.paymentType);
}

function childNeedsSaleMeta(child: InventoryItem, meta: ContainerSaleMeta): boolean {
  if (meta.platformSold && child.platformSold !== meta.platformSold) return true;
  if (meta.paymentType && child.paymentType !== meta.paymentType) return true;
  if (meta.ebayOrderId && child.ebayOrderId !== meta.ebayOrderId) return true;
  if (meta.ebayUsername && child.ebayUsername !== meta.ebayUsername) return true;
  if (meta.ebaySku && child.ebaySku !== meta.ebaySku) return true;
  if (meta.ebayListingId && child.ebayListingId !== meta.ebayListingId) return true;
  if (meta.kleinanzeigenChatUrl && child.kleinanzeigenChatUrl !== meta.kleinanzeigenChatUrl) {
    return true;
  }
  return false;
}

/** Apply container sale-platform fields onto one child (does not touch prices/status). */
export function applyContainerSaleMetaToChild(
  child: InventoryItem,
  meta: ContainerSaleMeta
): InventoryItem {
  if (!containerSaleMetaHasValue(meta) || !childNeedsSaleMeta(child, meta)) return child;
  return {
    ...child,
    ...(meta.platformSold ? { platformSold: meta.platformSold } : {}),
    ...(meta.paymentType ? { paymentType: meta.paymentType } : {}),
    ...(meta.ebayOrderId ? { ebayOrderId: meta.ebayOrderId } : {}),
    ...(meta.ebayUsername ? { ebayUsername: meta.ebayUsername } : {}),
    ...(meta.ebaySku ? { ebaySku: meta.ebaySku } : {}),
    ...(meta.ebayListingId ? { ebayListingId: meta.ebayListingId } : {}),
    ...(meta.kleinanzeigenChatUrl ? { kleinanzeigenChatUrl: meta.kleinanzeigenChatUrl } : {}),
  };
}

/**
 * For each touched sold PC/bundle, stamp linked parts with the same Sold-on /
 * payment / eBay identity. Idempotent; returns the same array reference when
 * nothing changes.
 */
export function syncContainerSaleMetaToChildren(
  items: InventoryItem[],
  touchedIds?: Iterable<string>
): InventoryItem[] {
  const touched = touchedIds ? new Set(touchedIds) : null;
  const patchById = new Map<string, InventoryItem>();

  for (const container of items) {
    if (!container.isPC && !container.isBundle) continue;
    if (touched && !touched.has(container.id)) continue;
    if (!isSoldOrTradedOnly(container)) continue;

    const meta = extractContainerSaleMeta(container);
    if (!containerSaleMetaHasValue(meta)) continue;

    for (const child of getChildren(container, items)) {
      if (child.isPC || child.isBundle) continue;
      const current = patchById.get(child.id) || child;
      const next = applyContainerSaleMetaToChild(current, meta);
      if (next !== current) patchById.set(child.id, next);
    }
  }

  if (patchById.size === 0) return items;
  return items.map((i) => patchById.get(i.id) || i);
}

/**
 * Expand a list of item patches so that any sold PC/bundle also yields a patch
 * for each child (used by bulk platform edit / eBay tag fix).
 */
export function expandUpdatesWithContainerSaleMeta(
  updates: InventoryItem[],
  allItems: InventoryItem[]
): InventoryItem[] {
  const byId = new Map<string, InventoryItem>();
  for (const u of updates) byId.set(u.id, u);

  for (const u of updates) {
    if (!u.isPC && !u.isBundle) continue;
    if (!isSoldOrTradedOnly(u)) continue;
    const meta = extractContainerSaleMeta(u);
    if (!containerSaleMetaHasValue(meta)) continue;

    for (const child of getChildren(u, allItems)) {
      if (child.isPC || child.isBundle) continue;
      const base = byId.get(child.id) || child;
      byId.set(child.id, applyContainerSaleMetaToChild(base, meta));
    }
  }

  return Array.from(byId.values());
}
