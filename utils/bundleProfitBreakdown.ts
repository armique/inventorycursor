import type { InventoryItem } from '../types';
import { formatEUR } from './formatMoney';
import { computeItemProfitBeforeOverhead } from '../services/financialAggregation';

export type BundleComponentProfit = {
  item: InventoryItem;
  buyPrice: number;
  allocatedSell: number;
  profit: number;
};

/** Per-component margin inside a sold bundle (#47). */
export function bundleComponentBreakdown(
  container: InventoryItem,
  allItems: InventoryItem[]
): BundleComponentProfit[] {
  if (!container.componentIds?.length) return [];
  const children = container.componentIds
    .map((id) => allItems.find((i) => i.id === id))
    .filter((i): i is InventoryItem => Boolean(i));
  if (children.length === 0) return [];

  const totalBuy = children.reduce((s, c) => s + Number(c.buyPrice || 0), 0);
  const containerSell = Number(container.sellPrice || 0);
  const totalProfit = computeItemProfitBeforeOverhead(container, allItems);

  return children.map((item) => {
    const buyPrice = Number(item.buyPrice || 0);
    const share = totalBuy > 0 ? buyPrice / totalBuy : 1 / children.length;
    const allocatedSell = containerSell * share;
    const profit = totalProfit * share;
    return { item, buyPrice, allocatedSell, profit };
  });
}

export function formatBundleProfitLine(row: BundleComponentProfit): string {
  return `${row.item.name}: buy €${formatEUR(row.buyPrice)} → €${formatEUR(row.allocatedSell)} (${row.profit >= 0 ? '+' : ''}€${formatEUR(row.profit)})`;
}
