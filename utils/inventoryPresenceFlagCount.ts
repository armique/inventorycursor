import { InventoryItem, ItemStatus } from '../types';
import { isRealizedDisposal, isSoldOrTradedOnly } from '../utils/itemDisposition';
import { getChildren } from '../services/financialAggregation';
import { resolveItemSourceLinks } from '../utils/sourceLinks';
import { canSplitItem, resolveIdenticalLotQty } from '../utils/splitParts';
import { getContainerKind } from '../utils/containerMembership';
import { hasEbaySaleSignals, resolveSalePlatform } from '../utils/salePlatform';
import { getEbayPublishReadiness } from '../utils/ebayListingReadiness';

/** Icons always shown inline in Flags (before the ⋯ menu). */
export const INLINE_PRESENCE_FLAG_MAX = 6;

/** Legacy full strip count — overflow actions live in the ⋯ menu now. */
export const PRESENCE_FLAG_SLOT_COUNT = 21;

function shouldShowEbayOrderLinkInFlags(item: InventoryItem): boolean {
  if (item.status !== ItemStatus.SOLD && item.status !== ItemStatus.TRADED) return false;
  if (item.platformSold === 'kleinanzeigen.de') return false;
  if (item.paymentType?.startsWith('Kleinanzeigen')) return false;
  if ((item.ebayOrderId || '').trim()) return true;
  if (item.status !== ItemStatus.SOLD) return false;
  const platform = resolveSalePlatform(item);
  if (platform === 'kleinanzeigen.de') return false;
  return platform === 'ebay.de' || hasEbaySaleSignals(item);
}

/** Count inline Flags icons for one row — drives auto column width. */
export function countInlinePresenceFlagsForItem(item: InventoryItem): number {
  let n = 0;
  if (!item.parentContainerId && (item.status === ItemStatus.IN_STOCK || item.status === ItemStatus.ORDERED)) {
    n += 1; // sell
  }
  if (!item.parentContainerId) n += 1; // delete (ghost when N/A keeps slot)
  n += 1; // presence cycle
  n += 2; // OVP + IO (IO slot always shown; ghost when N/A)
  n += 1; // ⋯ more menu
  return n;
}

/** @deprecated Prefer countInlinePresenceFlagsForItem — full overflow strip is behind ⋯. */
export function countPresenceFlagsForItem(
  item: InventoryItem,
  items: InventoryItem[],
  resolveBulkImportId?: (item: InventoryItem) => string | null
): number {
  let n = 0;

  if (!item.parentContainerId && (item.status === ItemStatus.IN_STOCK || item.status === ItemStatus.ORDERED)) {
    n += 1;
  }
  if (!item.parentContainerId) n += 1;

  if (!item.parentContainerId && (item.status === ItemStatus.IN_STOCK || item.status === ItemStatus.ORDERED)) {
    // Mutually exclusive: "listed on eBay" link, or "ready to publish" badge — never both.
    if (item.listedOnEbay && item.ebayListingId) n += 1;
    else if (getEbayPublishReadiness(item).ok) n += 1;
  }

  n += 1; // presence cycle
  n += 1; // user photos
  n += 1; // eBay listing photos
  n += 1; // AI product cards

  const soldLike = isRealizedDisposal(item) || item.status === ItemStatus.GIFTED;
  if (!soldLike) n += 1; // quick bundle / add parts

  if (resolveBulkImportId ? resolveBulkImportId(item) : item.bulkImportId) n += 1;

  if (getContainerKind(item)) n += 1; // rebuild title

  if (item.isPC || item.isBundle) n += 1; // unbundle

  const childCount = item.isPC || item.isBundle ? getChildren(item, items).length : 0;
  if (canSplitItem(item, childCount)) n += 1;

  if ((item.isPC || item.isBundle) && childCount > 0) n += 1; // calculator

  if (item.status === ItemStatus.IN_STOCK) {
    n += 2; // trade + gift
  }

  if (isSoldOrTradedOnly(item)) n += 1; // invoice

  if (item.status === ItemStatus.SOLD) n += 1; // buyer / order edit

  if (item.status === ItemStatus.SOLD || item.status === ItemStatus.GIFTED) n += 1; // return / undo gift

  if (shouldShowEbayOrderLinkInFlags(item)) {
    n += 1;
  } else {
    const links = resolveItemSourceLinks(item);
    if (links.chat || links.order || links.profile) n += 1;
  }

  return n;
}

/** Widest row in the sample (inline strip only). */
export function maxPresenceFlagsInItems(items: InventoryItem[]): number {
  if (!items.length) return 4;
  let max = 0;
  for (const item of items) {
    max = Math.max(max, countInlinePresenceFlagsForItem(item));
  }
  return Math.min(INLINE_PRESENCE_FLAG_MAX, Math.max(1, max));
}

export function presenceColWidthFromFlagCount(
  flagCount: number,
  options?: { dense?: boolean; lotBadge?: boolean }
): number {
  const dense = options?.dense ?? false;
  const iconPx = dense ? 24 : 28;
  const gapPx = dense ? 0 : 1;
  const hPad = dense ? 6 : 8;
  const count = Math.max(1, Math.min(INLINE_PRESENCE_FLAG_MAX, flagCount));
  const strip =
    count * iconPx + Math.max(0, count - 1) * gapPx + (options?.lotBadge ? 10 : 0);
  return strip + hPad;
}

/** True when any row shows a split-lot ×N badge (slightly wider scissors button). */
export function sampleHasSplitLotBadge(items: InventoryItem[]): boolean {
  for (const item of items) {
    const childCount = item.isPC || item.isBundle ? getChildren(item, items).length : 0;
    if (canSplitItem(item, childCount) && resolveIdenticalLotQty(item) != null) return true;
  }
  return false;
}
