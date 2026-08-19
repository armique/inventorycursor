import type { InventoryItem } from '../types';
import type { EbayOrderRecord } from '../services/ebayOrderIndex';
import { hubOrderIdFromItem } from './replaceItemSaleProceedsFromHub';

export function hubLineItemTitles(order: EbayOrderRecord): string[] {
  return (order.lineItems || []).map((li) => li.title?.trim()).filter((t): t is string => Boolean(t));
}

export function hubOrderDisplayTitle(
  order: EbayOrderRecord,
  items: InventoryItem[],
  apiOrders?: EbayOrderRecord[]
): { title: string; extraCount: number } {
  const hub = hubLineItemTitles(order);
  if (hub[0]) return { title: hub[0], extraCount: Math.max(0, hub.length - 1) };
  const api = apiOrders?.find((o) => o.orderId === order.orderId);
  const apiTitles = api ? hubLineItemTitles(api) : [];
  if (apiTitles[0]) return { title: apiTitles[0], extraCount: Math.max(0, apiTitles.length - 1) };
  const linked = items.filter((item) => hubOrderIdFromItem(item) === order.orderId);
  const name = linked[0]?.name?.trim() || '';
  if (name) return { title: name, extraCount: Math.max(0, linked.length - 1) };
  return { title: '', extraCount: 0 };
}
