/**
 * AMD Radeon RX 6500 XT · eBay 19-15037-10451 (19 Aug 2026).
 * sellPrice was item-only €95,03; Hub Gesamtbetrag is €101,22 (+€6,19 Käufer-Versand).
 */
import { ItemStatus, type InventoryItem, type TaxMode } from '../types';
import { computeSoldTabMargin, roundMoney } from '../services/financialAggregation';

export const RX6500XT_ORDER_ID = '19-15037-10451';
export const RX6500XT_BUYER_TOTAL = 101.22;

function orderKey(id: string | undefined): string {
  return String(id || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]/g, '');
}

function moneyEq(value: unknown, expected: number): boolean {
  return roundMoney(Number(value)) === expected;
}

export function matchesRx6500XtHubSell(item: InventoryItem): boolean {
  if (item.status !== ItemStatus.SOLD && item.status !== ItemStatus.TRADED) return false;
  return orderKey(item.ebayOrderId) === orderKey(RX6500XT_ORDER_ID);
}

export function applyRx6500XtHubSellSync(
  items: InventoryItem[],
  _taxMode?: TaxMode
): { items: InventoryItem[]; changed: boolean } {
  let changed = false;
  const next = items.map((item) => {
    if (!matchesRx6500XtHubSell(item)) return item;
    const buyer = item.saleProceeds?.buyerTotalEur ?? RX6500XT_BUYER_TOTAL;
    if (moneyEq(item.sellPrice, buyer) && moneyEq(item.saleProceeds?.buyerTotalEur, buyer)) return item;
    changed = true;
    const patched: InventoryItem = {
      ...item,
      originalSellPrice: item.originalSellPrice ?? item.sellPrice,
      sellPrice: roundMoney(buyer),
      saleProceeds: item.saleProceeds
        ? { ...item.saleProceeds, buyerTotalEur: roundMoney(buyer) }
        : item.saleProceeds,
    };
    return { ...patched, profit: parseFloat(computeSoldTabMargin(patched).toFixed(2)) };
  });
  return { items: changed ? next : items, changed };
}
