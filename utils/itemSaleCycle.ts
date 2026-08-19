import type {
  InventoryItem,
  ItemSaleCycle,
  ItemSaleCycleReason,
  ItemStatus,
} from '../types';
import { ItemStatus as Status } from '../types';

const CYCLE_REASON_LABEL: Record<ItemSaleCycleReason, string> = {
  erstattet: 'Erstattet — full refund, returned to stock',
  return: 'Buyer return — returned to stock',
  cancelled: 'Order cancelled — returned to stock',
  manual_unsold: 'Marked unsold — returned to stock',
};

export function saleCycleReasonLabel(reason: ItemSaleCycleReason): string {
  return CYCLE_REASON_LABEL[reason];
}

export function itemHasActiveSaleSnapshot(item: InventoryItem): boolean {
  return Boolean(
    item.ebayOrderId?.trim() ||
      item.ebayOrderLineKey?.trim() ||
      item.sellDate ||
      item.sellPrice != null ||
      item.customer?.name ||
      item.saleProceeds ||
      item.originalSellPrice != null
  );
}

export function itemClosedSaleOrderIds(item: InventoryItem): Set<string> {
  const ids = new Set<string>();
  for (const cycle of item.ebaySaleCycles || []) {
    const id = cycle.ebayOrderId?.trim();
    if (id) ids.add(id.toLowerCase());
  }
  return ids;
}

export function itemAlreadyClosedSaleOrder(item: InventoryItem, orderId: string | undefined | null): boolean {
  const key = String(orderId || '')
    .trim()
    .toLowerCase();
  if (!key) return false;
  return itemClosedSaleOrderIds(item).has(key);
}

export function claimedLineKeysFromSaleCycles(items: InventoryItem[]): Set<string> {
  const keys = new Set<string>();
  for (const item of items) {
    for (const cycle of item.ebaySaleCycles || []) {
      const line = cycle.ebayOrderLineKey?.trim();
      if (line) keys.add(line);
    }
  }
  return keys;
}

export function snapshotSaleCycle(
  item: InventoryItem,
  reason: ItemSaleCycleReason,
  extras?: {
    leftoverLossEur?: number;
    refundEur?: number;
    refundKind?: 'full' | 'partial';
    buyPriceAtClose?: number;
  }
): ItemSaleCycle {
  const leftover = extras?.leftoverLossEur != null && extras.leftoverLossEur >= 0.01 ? extras.leftoverLossEur : undefined;
  return {
    id: `cycle-${item.id}-${item.ebayOrderId || item.sellDate || 'na'}-${item.ebaySaleCycles?.length || 0}`,
    closedAt: new Date().toISOString(),
    reason,
    reasonLabel: saleCycleReasonLabel(reason),
    sellDate: item.sellDate,
    sellPrice: item.sellPrice,
    originalSellPrice: item.originalSellPrice,
    profit: item.profit,
    platformSold: item.platformSold,
    paymentType: item.paymentType,
    ebayOrderId: item.ebayOrderId,
    ebayOrderLineKey: item.ebayOrderLineKey,
    ebayUsername: item.ebayUsername,
    ebayListingId: item.ebayListingId,
    ebaySku: item.ebaySku,
    customer: item.customer,
    saleProceeds: item.saleProceeds,
    ebaySaleAdjustments: item.ebaySaleAdjustments,
    feeAmount: item.feeAmount,
    hasFee: item.hasFee,
    sellerPaidShipping: item.sellerPaidShipping,
    sellerShippingAmount: item.sellerShippingAmount,
    invoiceNumber: item.invoiceNumber,
    buyPriceAtClose: extras?.buyPriceAtClose ?? item.buyPrice,
    leftoverLossEur: leftover,
    refundEur: extras?.refundEur,
    refundKind: extras?.refundKind,
  };
}

function alreadyHasCycleForOrder(item: InventoryItem, orderId: string | undefined): boolean {
  const key = (orderId || '').trim().toLowerCase();
  if (!key) return false;
  return (item.ebaySaleCycles || []).some((c) => (c.ebayOrderId || '').trim().toLowerCase() === key);
}

/**
 * Freeze the live sale into ebaySaleCycles, then clear live buyer/order/proceeds
 * so a later eBay sale can bind a new order. Listing ids / specs stay.
 */
export function archiveActiveSaleAndClear(
  item: InventoryItem,
  reason: ItemSaleCycleReason,
  extras?: {
    leftoverLossEur?: number;
    refundEur?: number;
    refundKind?: 'full' | 'partial';
    buyPriceAfter?: number;
    status?: ItemStatus;
    comment2?: string;
  }
): InventoryItem {
  const cycles = [...(item.ebaySaleCycles || [])];
  if (itemHasActiveSaleSnapshot(item) && !alreadyHasCycleForOrder(item, item.ebayOrderId)) {
    cycles.push(
      snapshotSaleCycle(item, reason, {
        leftoverLossEur: extras?.leftoverLossEur,
        refundEur: extras?.refundEur,
        refundKind: extras?.refundKind,
        buyPriceAtClose: item.buyPrice,
      })
    );
  }

  return {
    ...item,
    status: extras?.status ?? Status.IN_STOCK,
    comment2: extras?.comment2 ?? item.comment2,
    buyPrice: extras?.buyPriceAfter ?? item.buyPrice,
    ebaySaleCycles: cycles.length ? cycles : item.ebaySaleCycles,
    sellPrice: undefined,
    sellDate: undefined,
    profit: undefined,
    platformSold: undefined,
    paymentType: undefined,
    feeAmount: undefined,
    hasFee: false,
    sellerPaidShipping: false,
    sellerShippingAmount: undefined,
    saleProceeds: undefined,
    invoiceNumber: undefined,
    customer: undefined,
    giftRecipient: undefined,
    giftRelation: undefined,
    ebayOrderId: undefined,
    ebayOrderLineKey: undefined,
    originalSellPrice: undefined,
    ebaySaleAdjustments: undefined,
    containerSoldDate: undefined,
    ebayUsername: undefined,
    externalOrderId: undefined,
    sourceOrderUrl: undefined,
    ebayOrderScreenshotUrl: undefined,
  };
}

export function formatSaleCycleSummary(cycle: ItemSaleCycle): string {
  const date = cycle.sellDate || cycle.closedAt.slice(0, 10);
  const order = cycle.ebayOrderId ? `#${cycle.ebayOrderId}` : 'no order id';
  const buyer = cycle.customer?.name || cycle.ebayUsername || 'buyer unknown';
  const price = cycle.sellPrice != null ? `€${cycle.sellPrice.toFixed(2)}` : '—';
  const loss =
    cycle.leftoverLossEur != null && cycle.leftoverLossEur >= 0.01
      ? ` · leftover +€${cycle.leftoverLossEur.toFixed(2)} EK`
      : '';
  return `${date} · ${order} · ${buyer} · ${price} · ${cycle.reasonLabel}${loss}`;
}
