import type { InventoryItem } from '../types';
import { ItemStatus } from '../types';
import { shouldSkipForAggregatedSaleLine } from '../services/financialAggregation';
import { scoreListingTitleMatch } from './ebayListingMatch';
import type { EbayTxOrderLedger, EbayTxRow } from './ebayTransactionReport';
import { isRealizedDisposal } from './itemDisposition';
import { ebayTxBuyerTotalEur } from './linkInventoryItemToEbayTx';

export type EbayTxMatchKind = 'order' | 'listingId' | 'sku' | 'title' | 'price';

export type EbayTxItemCandidate = {
  item: InventoryItem;
  score: number;
  kind: EbayTxMatchKind;
  alreadyLinked: boolean;
  /** Same-day / close sell-date match boost (for sorting). */
  dateScore: number;
  /** Close sold-price match boost (for sorting). */
  priceScore: number;
  titleScore: number;
};

export function itemLinkedToEbayTxOrder(item: InventoryItem, orderId: string): boolean {
  return (item.ebayOrderId || '').trim() === orderId;
}

export function isEbayTxLinkCandidate(item: InventoryItem, allItems: InventoryItem[]): boolean {
  if (item.isDraft) return false;
  if (shouldSkipForAggregatedSaleLine(item, allItems)) return false;
  return (
    item.status === ItemStatus.IN_STOCK ||
    item.status === ItemStatus.ORDERED ||
    isRealizedDisposal(item)
  );
}

function inventorySellDayKey(item: InventoryItem): string {
  const raw = item.sellDate || item.containerSoldDate || '';
  return raw.slice(0, 10);
}

function txDayKey(row: EbayTxRow): string {
  return (row.createdSort || row.createdAt || '').slice(0, 10);
}

/** Higher = sell date closer to the eBay order date. */
export function ebayTxDateProximityScore(itemDay: string, txDay: string): number {
  if (!itemDay || !txDay) return 0;
  const ms = Math.abs(Date.parse(`${itemDay}T12:00:00`) - Date.parse(`${txDay}T12:00:00`));
  if (!Number.isFinite(ms)) return 0;
  const days = Math.round(ms / 86400000);
  if (days === 0) return 600;
  if (days <= 2) return 450;
  if (days <= 7) return 280;
  if (days <= 14) return 120;
  return 0;
}

/** Higher = inventory sell price closer to the order buyer total (item + ship). */
export function ebayTxPriceProximityScore(itemEur: number, orderEur: number): number {
  if (!(itemEur >= 0.01) || !(orderEur >= 0.01)) return 0;
  const gap = Math.abs(itemEur - orderEur);
  if (gap <= 0.05) return 550;
  if (gap <= 1.5) return 450;
  if (gap <= 5) return 280;
  if (gap <= 10) return 120;
  if (gap <= 20) return 40;
  return 0;
}

export function scoreItemAgainstEbayTx(
  item: InventoryItem,
  row: EbayTxRow,
  ledger: EbayTxOrderLedger | null
): Pick<EbayTxItemCandidate, 'score' | 'kind' | 'dateScore' | 'priceScore' | 'titleScore'> {
  if (itemLinkedToEbayTxOrder(item, row.orderId)) {
    return { score: 2000, kind: 'order', dateScore: 0, priceScore: 0, titleScore: 0 };
  }
  if (item.ebayListingId && row.listingId && item.ebayListingId === row.listingId) {
    return { score: 1000, kind: 'listingId', dateScore: 0, priceScore: 0, titleScore: 0 };
  }
  if (item.ebaySku && row.sku && item.ebaySku.trim().toLowerCase() === row.sku.trim().toLowerCase()) {
    return { score: 900, kind: 'sku', dateScore: 0, priceScore: 0, titleScore: 0 };
  }

  let titleScore = 0;
  let kind: EbayTxMatchKind = 'title';
  if (item.name?.trim() && row.title) {
    titleScore = scoreListingTitleMatch(item.name, row.title, row.sku || undefined, item.ebaySku);
  }

  const sell = Number(item.saleProceeds?.buyerTotalEur ?? item.sellPrice) || 0;
  const orderTotal = ebayTxBuyerTotalEur(row, ledger);
  const priceScore = ebayTxPriceProximityScore(sell, orderTotal);
  const dateScore = ebayTxDateProximityScore(inventorySellDayKey(item), txDayKey(row));

  if (priceScore >= 120 && titleScore < 80) kind = 'price';

  const score = titleScore + dateScore + priceScore;
  return { score, kind, dateScore, priceScore, titleScore };
}

function compareEbayTxMatchCandidates(a: EbayTxItemCandidate, b: EbayTxItemCandidate): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.dateScore !== a.dateScore) return b.dateScore - a.dateScore;
  if (b.priceScore !== a.priceScore) return b.priceScore - a.priceScore;
  if (b.titleScore !== a.titleScore) return b.titleScore - a.titleScore;
  return a.item.name.localeCompare(b.item.name);
}

export function findEbayTxInventoryMatches(
  items: InventoryItem[],
  row: EbayTxRow,
  ledger: EbayTxOrderLedger | null,
  query = '',
  limit = 8
): EbayTxItemCandidate[] {
  const q = query.trim().toLowerCase();
  const out: EbayTxItemCandidate[] = [];
  for (const item of items) {
    if (!isEbayTxLinkCandidate(item, items)) continue;
    if (q) {
      const hay = [item.name, item.ebaySku, item.ebayOrderId, item.ebayUsername, item.customer?.name]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) continue;
    }
    const ranked = scoreItemAgainstEbayTx(item, row, ledger);
    const linked = itemLinkedToEbayTxOrder(item, row.orderId);
    const strongDateOrPrice = ranked.dateScore >= 120 || ranked.priceScore >= 120;
    if (!q && ranked.score < 25 && !linked && !strongDateOrPrice) continue;
    out.push({
      item,
      score: ranked.score,
      kind: ranked.kind,
      alreadyLinked: linked,
      dateScore: ranked.dateScore,
      priceScore: ranked.priceScore,
      titleScore: ranked.titleScore,
    });
  }
  out.sort(compareEbayTxMatchCandidates);
  return out.slice(0, limit);
}

export function findInventoryItemForEbayTxOrder(items: InventoryItem[], orderId: string): InventoryItem | null {
  if (!orderId) return null;
  let linked: InventoryItem | null = null;
  for (const item of items) {
    if ((item.ebayOrderId || '').trim() !== orderId) continue;
    if (!linked || !item.parentContainerId) linked = item;
  }
  return linked;
}
