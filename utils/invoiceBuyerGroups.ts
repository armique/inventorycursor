import { InventoryItem } from '../types';

export type BuyerInvoiceGroup = {
  key: string;
  label: string;
  sublabel?: string;
  itemIds: string[];
  total: number;
};

export function buyerGroupKey(item: InventoryItem): string {
  if (item.ebayOrderId?.trim()) return `ebay:${item.ebayOrderId.trim()}`;
  const name = item.customer?.name?.trim().toLowerCase();
  const date = item.sellDate?.slice(0, 10) || '';
  if (name) return `buyer:${name}|${date}`;
  return `solo:${item.id}`;
}

export function buildBuyerInvoiceGroups(items: InventoryItem[]): BuyerInvoiceGroup[] {
  const map = new Map<string, InventoryItem[]>();
  for (const item of items) {
    const key = buyerGroupKey(item);
    const list = map.get(key) || [];
    list.push(item);
    map.set(key, list);
  }
  const groups: BuyerInvoiceGroup[] = [];
  for (const [key, groupItems] of map) {
    const first = groupItems[0]!;
    let label = first.customer?.name?.trim() || first.ebayUsername || first.name;
    let sublabel: string | undefined;
    if (key.startsWith('ebay:')) {
      label = first.customer?.name?.trim() || `eBay order ${first.ebayOrderId}`;
      sublabel = first.ebayOrderId || undefined;
    } else if (groupItems.length === 1) {
      sublabel = first.sellDate ? `Sold ${first.sellDate}` : undefined;
    } else {
      sublabel = `${groupItems.length} items · ${first.sellDate || 'same buyer'}`;
    }
    groups.push({
      key,
      label,
      sublabel,
      itemIds: groupItems.map((i) => i.id),
      total: groupItems.reduce((s, i) => s + (i.sellPrice || 0), 0),
    });
  }
  return groups.sort((a, b) => b.total - a.total);
}
