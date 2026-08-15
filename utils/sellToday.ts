import { ItemStatus, type InventoryItem } from '../types';
import { getListingPrepChecklist } from './listingPrepChecklist';

export type SellTodayRow = {
  item: InventoryItem;
  ageDays: number;
  marginPct: number;
  profit: number;
  photosReady: boolean;
  listedEbay: boolean;
  reserved: boolean;
  score: number;
};

export function itemPhotosReady(item: InventoryItem): boolean {
  if (item.photosReady === true) return true;
  if (item.photosReady === false) return false;
  return getListingPrepChecklist(item).hasPhotos;
}

export function itemAgeDays(item: InventoryItem, now = Date.now()): number {
  const raw = item.buyDate || '';
  const t = raw ? new Date(raw).getTime() : NaN;
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

export function itemMargin(item: InventoryItem): { marginPct: number; profit: number } {
  const buy = Number(item.buyPrice) || 0;
  const sell = Number(item.storeSalePrice ?? item.sellPrice) || 0;
  const profit = sell - buy;
  const marginPct = sell > 0 ? (profit / sell) * 100 : 0;
  return { marginPct, profit };
}

export function buildSellTodayRows(items: InventoryItem[], now = Date.now()): SellTodayRow[] {
  const rows: SellTodayRow[] = [];
  for (const item of items) {
    if (item.status !== ItemStatus.IN_STOCK) continue;
    if (item.isDraft || item.isDefective) continue;
    if (item.parentContainerId) continue;
    if (item.reserved) continue;
    const { marginPct, profit } = itemMargin(item);
    const ageDays = itemAgeDays(item, now);
    const photosReady = itemPhotosReady(item);
    const score = ageDays * 2 + marginPct + (photosReady ? 40 : 0) + (item.listedOnEbay ? 8 : 0);
    rows.push({
      item,
      ageDays,
      marginPct,
      profit,
      photosReady,
      listedEbay: Boolean(item.listedOnEbay),
      reserved: false,
      score,
    });
  }
  return rows.sort((a, b) => b.score - a.score || b.ageDays - a.ageDays);
}
