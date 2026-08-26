import { ItemStatus, type InventoryItem, type SaleProceedsBreakdown, type TaxMode } from '../types';
import { roundMoney } from '../services/financialAggregation';
import { buildCostOrigin } from './costOrigin';
import type { EbayTxOrderLedger, EbayTxRow } from './ebayTransactionReport';
import { ebayTxOrderSellDate } from './ebayTransactionReport';
import { calculateSaleProfit } from './saleProfit';
import { unlinkAbrechnungSaleAndRestorePrevious, archiveLiveSaleBeforeAbrechnungLink, type UnlinkAbrechnungSaleResult } from './itemSaleCycle';
import { syncSoldContainerFamilyEqual } from './containerChildSoldDisplay';
import {
  applyContainerSaleMetaToChild,
  extractContainerSaleMeta,
} from './containerSaleCascade';
import { restockItemFields } from '../services/saleRevert';
import { getChildren } from '../services/financialAggregation';

export function addressFromEbayTxRow(row: EbayTxRow): string {
  return [row.zip, row.city, row.country].filter(Boolean).join(', ');
}

export function saleProceedsFromEbayTxLedger(
  row: EbayTxRow,
  ledger: EbayTxOrderLedger | null,
  /** True when this row stands in for the whole order (linking a bundle/container to a
   *  multi-line order) — use the ledger's summed-across-all-lines totals instead of just
   *  this one row's own item price, so the container doesn't under-claim revenue that
   *  actually belongs to sibling line items. */
  useOrderTotal = false
): SaleProceedsBreakdown {
  const lineGross = roundMoney((row.itemSubtotalEur ?? 0) + (row.shippingEur ?? 0));
  const ledgerGross = ledger ? roundMoney(ledger.itemEur + ledger.buyerShipEur) : 0;
  const useLedgerTotal = useOrderTotal && ledgerGross >= 0.01;
  const itemGross = useLedgerTotal
    ? ledger!.itemEur
    : lineGross >= 0.01 ? roundMoney(row.itemSubtotalEur ?? 0) : ledger?.itemEur || row.itemSubtotalEur || 0;
  const buyerShip = useLedgerTotal
    ? ledger!.buyerShipEur
    : lineGross >= 0.01 ? roundMoney(row.shippingEur ?? 0) : ledger?.buyerShipEur || row.shippingEur || 0;
  const buyerTotal = useLedgerTotal
    ? ledgerGross
    : lineGross >= 0.01 ? lineGross : ledger?.grossEur || row.grossEur || roundMoney(itemGross + buyerShip);
  const fvf = Math.abs(ledger?.fvfEur || 0);
  const ads = Math.abs(ledger?.adsEur || 0);
  const label = Math.abs(ledger?.labelEur || 0);
  const other = ledger?.otherEur || 0;
  const refund = other < -0.005 ? Math.abs(other) : 0;
  const otherFee = other > 0.005 ? other : 0;
  const pocket = ledger?.pocketEur ?? row.netEur ?? roundMoney(buyerTotal - fvf - ads - label);
  return {
    capturedAt: new Date().toISOString(),
    source: 'ebay_order',
    itemGrossEur: itemGross || null,
    buyerShippingEur: buyerShip || null,
    buyerTotalEur: buyerTotal || null,
    transactionFeeEur: fvf || null,
    adFeeEur: ads || null,
    shippingLabelEur: label || null,
    otherFeeEur: otherFee || null,
    refundEur: refund || null,
    netPayoutEur: pocket,
    feesEstimated: false,
  };
}

/** Bind a Bestellung row onto inventory: order id, buyer, address, official Pocket split. */
export function linkInventoryItemToEbayTx(
  item: InventoryItem,
  row: EbayTxRow,
  ledger: EbayTxOrderLedger | null,
  taxMode: TaxMode,
  options?: { renameToOrderTitle?: boolean; useOrderTotal?: boolean }
): InventoryItem {
  const archived = archiveLiveSaleBeforeAbrechnungLink(item, row.orderId);
  const proceeds = saleProceedsFromEbayTxLedger(row, ledger, options?.useOrderTotal);
  const buyerTotal = proceeds.buyerTotalEur || 0;
  const fee =
    (proceeds.transactionFeeEur || 0) +
    (proceeds.adFeeEur || 0) +
    (proceeds.shippingLabelEur || 0) +
    (proceeds.otherFeeEur || 0);
  const address = addressFromEbayTxRow(row);
  const name = row.buyerName || row.buyerUsername || '';
  const orderTitle = (row.title || row.description || '').trim();
  const profit = calculateSaleProfit(buyerTotal, Number(item.buyPrice) || 0, fee, taxMode);
  const markSold = item.status === ItemStatus.IN_STOCK || item.status === ItemStatus.ORDERED;
  // CSV Bestellung date and buyer total always win when linking from Abrechnung.
  const csvSellDate = ebayTxOrderSellDate(row);
  // CSV Bestellung date is always source of truth when present.
  const sellDate = csvSellDate || archived.sellDate;

  return {
    ...archived,
    ...(options?.renameToOrderTitle && orderTitle ? { name: orderTitle } : {}),
    status: markSold ? ItemStatus.SOLD : archived.status,
    originalSellPrice: buyerTotal,
    sellPrice: buyerTotal,
    sellDate: sellDate || undefined,
    containerSoldDate: undefined,
    platformSold: 'ebay.de',
    paymentType: 'ebay.de',
    profit: parseFloat(profit.toFixed(2)),
    customer: {
      name: name || archived.customer?.name || '',
      address: address || archived.customer?.address || '',
      ...(archived.customer?.phone ? { phone: archived.customer.phone } : {}),
      ...(archived.customer?.email ? { email: archived.customer.email } : {}),
    },
    ebayUsername: row.buyerUsername || archived.ebayUsername,
    ebayOrderId: row.orderId,
    ebayOrderLineKey: `${row.orderId}::${row.sku || row.listingId || row.title || 'line'}`,
    ebaySku: row.sku || archived.ebaySku,
    ebayListingId: row.listingId || archived.ebayListingId,
    hasFee: fee >= 0.01,
    feeAmount: roundMoney(fee),
    sellerPaidShipping: false,
    sellerShippingAmount: undefined,
    saleProceeds: proceeds,
    kleinanzeigenChatUrl: undefined,
    kleinanzeigenChatImage: undefined,
  };
}

export function ebayTxBuyerTotalEur(row: EbayTxRow, ledger: EbayTxOrderLedger | null): number {
  const lineGross = roundMoney((row.itemSubtotalEur ?? 0) + (row.shippingEur ?? 0));
  if (lineGross >= 0.01) return lineGross;
  return roundMoney(ledger?.grossEur || row.grossEur || 0);
}

/** Buy date for stub items created from a Bestellung with no inventory match. */
export function randomEbayTxStubBuyDate(): string {
  const start = Date.UTC(2026, 1, 1);
  const end = Date.UTC(2026, 4, 31);
  const days = Math.round((end - start) / 86400000);
  const offset = Math.floor(Math.random() * (days + 1));
  return new Date(start + offset * 86400000).toISOString().slice(0, 10);
}

/** New inventory row: same title, buy = 50% of sell, buy date Feb–May 2026. */
export function createInventoryItemFromEbayTx(
  row: EbayTxRow,
  ledger: EbayTxOrderLedger | null
): InventoryItem {
  const sell = ebayTxBuyerTotalEur(row, ledger);
  const buyPrice = roundMoney(sell * 0.5);
  const buyDate = randomEbayTxStubBuyDate();
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? `item-${crypto.randomUUID()}`
      : `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const name = (row.title || row.description || 'eBay order').trim();
  return {
    id,
    name,
    buyPrice,
    buyDate,
    category: 'Components',
    status: ItemStatus.IN_STOCK,
    comment1: `Created from eBay Abrechnung — no inventory match. Buy set to 50% of sell (€${buyPrice.toFixed(2)} of €${sell.toFixed(2)}).`,
    comment2: [row.orderId ? `Order ${row.orderId}` : '', row.listingId ? `listing ${row.listingId}` : '']
      .filter(Boolean)
      .join(' · '),
    platformBought: 'Other',
    listedOnEbay: true,
    ebaySku: row.sku || undefined,
    ebayListingId: row.listingId || undefined,
    costOrigin: buildCostOrigin({
      kind: 'single_add',
      addedAs: 'Abrechnung stub · 50% of sell',
      lotTotalEur: buyPrice,
      allocatedEur: buyPrice,
      allocationMethod: 'manual',
      siblings: [{ id, name, allocatedEur: buyPrice }],
      notes: `Buy date randomized Feb–May 2026 (${buyDate}).`,
    }),
  };
}

export function createAndLinkInventoryItemFromEbayTx(
  row: EbayTxRow,
  ledger: EbayTxOrderLedger | null,
  taxMode: TaxMode
): InventoryItem {
  return linkInventoryItemToEbayTx(createInventoryItemFromEbayTx(row, ledger), row, ledger, taxMode);
}

/** Undo a wrong Abrechnung link: archive mistaken sale, restore prior cycle when available. */
export function unlinkInventoryItemFromEbayTx(
  item: InventoryItem,
  orderId: string
): UnlinkAbrechnungSaleResult | null {
  const result = unlinkEbayTxOrderFromInventory([item], orderId, item);
  if (!result) return null;
  const next = result.updates.find((row) => row.id === item.id) || result.updates[0];
  if (!next) return null;
  return {
    item: next,
    restoredPreviousSale: result.restoredPreviousSale,
    restoredOrderId: result.restoredOrderId,
    restoredSellPrice: result.restoredSellPrice,
  };
}

export type UnlinkEbayTxOrderResult = {
  updates: InventoryItem[];
  deleteIds?: string[];
  restoredPreviousSale: boolean;
  restoredOrderId?: string;
  restoredSellPrice?: number;
  message: string;
};

function orderIdsMatch(a: string | undefined | null, b: string | undefined | null): boolean {
  const left = (a || '').trim().toLowerCase();
  const right = (b || '').trim().toLowerCase();
  return Boolean(left && right && left === right);
}

function abrechnungUnlinkTag(orderId: string): string {
  return `[Abrechnung unlink ${orderId.trim()} ${new Date().toLocaleDateString()}]`;
}

function withAbrechnungUnlinkTag(item: InventoryItem, orderId: string): InventoryItem {
  const tag = abrechnungUnlinkTag(orderId);
  if ((item.comment2 || '').includes(tag)) return item;
  return {
    ...item,
    comment2: item.comment2?.trim() ? `${item.comment2.trim()} ${tag}` : tag,
  };
}

function itemsLinkedToEbayOrder(allItems: InventoryItem[], orderId: string): InventoryItem[] {
  return allItems.filter((item) => orderIdsMatch(item.ebayOrderId, orderId));
}

function pickUnlinkRoot(
  linked: InventoryItem[],
  allItems: InventoryItem[],
  primary?: InventoryItem | null
): InventoryItem | null {
  if (!linked.length) return null;
  if (primary && linked.some((item) => item.id === primary.id)) {
    if (primary.parentContainerId) {
      const parent = allItems.find((item) => item.id === primary.parentContainerId);
      if (parent && orderIdsMatch(parent.ebayOrderId, primary.ebayOrderId)) return parent;
    }
    return primary;
  }
  return (
    linked.find((item) => (item.isBundle || item.isPC) && !item.parentContainerId) ||
    linked.find((item) => !item.parentContainerId) ||
    linked[0] ||
    null
  );
}

/** Unlink every inventory row bound to this Bestellung (bundle shell + parts). */
export function unlinkEbayTxOrderFromInventory(
  allItems: InventoryItem[],
  orderId: string,
  primary?: InventoryItem | null
): UnlinkEbayTxOrderResult | null {
  const target = orderId.trim();
  if (!target) return null;

  const linked = itemsLinkedToEbayOrder(allItems, target);
  if (!linked.length) return null;

  const root = pickUnlinkRoot(linked, allItems, primary);
  if (!root) return null;

  const updates: InventoryItem[] = [];
  const deleteIds: string[] = [];
  const seen = new Set<string>();
  let restoredPreviousSale = false;
  let restoredOrderId: string | undefined;
  let restoredSellPrice: number | undefined;

  const push = (item: InventoryItem) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    updates.push(item);
  };

  const isSoldBundleRoot =
    (root.isBundle || root.isPC) &&
    (Boolean(root.componentIds?.length) || linked.some((item) => item.parentContainerId === root.id));

  if (isSoldBundleRoot) {
    const childIds = new Set(root.componentIds || []);
    for (const item of linked) {
      if (item.parentContainerId === root.id) childIds.add(item.id);
    }
    for (const child of getChildren(root, allItems)) {
      if (orderIdsMatch(child.ebayOrderId, target)) childIds.add(child.id);
    }

    for (const childId of childIds) {
      const child = allItems.find((item) => item.id === childId);
      if (!child) continue;
      const restocked = restockItemFields(withAbrechnungUnlinkTag(child, target), {
        cycleReason: 'manual_unsold',
        status: ItemStatus.IN_STOCK,
      });
      push({ ...restocked, parentContainerId: undefined });
    }

    const shellResult = unlinkAbrechnungSaleAndRestorePrevious(withAbrechnungUnlinkTag(root, target), target);
    if (shellResult) {
      if (shellResult.restoredPreviousSale) {
        push(shellResult.item);
        restoredPreviousSale = true;
        restoredOrderId = shellResult.restoredOrderId;
        restoredSellPrice = shellResult.restoredSellPrice;
      } else {
        deleteIds.push(root.id);
      }
    }

    for (const item of linked) {
      if (item.id === root.id || childIds.has(item.id) || seen.has(item.id)) continue;
      const result = unlinkAbrechnungSaleAndRestorePrevious(withAbrechnungUnlinkTag(item, target), target);
      if (result) {
        push(result.item);
        if (result.restoredPreviousSale) {
          restoredPreviousSale = true;
          restoredOrderId = result.restoredOrderId;
          restoredSellPrice = result.restoredSellPrice;
        }
      }
    }

    return {
      updates,
      deleteIds: deleteIds.length ? deleteIds : undefined,
      restoredPreviousSale,
      restoredOrderId,
      restoredSellPrice,
      message: `Unlinked ${target} from sold bundle — ${childIds.size} part(s) back in stock.`,
    };
  }

  for (const item of linked) {
    const result = unlinkAbrechnungSaleAndRestorePrevious(withAbrechnungUnlinkTag(item, target), target);
    if (!result) continue;
    push(result.item);
    if (result.restoredPreviousSale) {
      restoredPreviousSale = true;
      restoredOrderId = result.restoredOrderId;
      restoredSellPrice = result.restoredSellPrice;
    }
  }

  if (!updates.length) return null;

  return {
    updates,
    restoredPreviousSale,
    restoredOrderId,
    restoredSellPrice,
    message: restoredPreviousSale
      ? `Unlinked ${target} — restored prior sale${restoredOrderId ? ` ${restoredOrderId}` : ''}.`
      : `Unlinked ${target} — ${updates.length} item(s) back in stock.`,
  };
}

function bundleTitleFromOrder(row: EbayTxRow, partCount: number): string {
  const raw = (row.title || row.description || '').trim();
  if (raw) {
    const clipped = raw.length > 72 ? `${raw.slice(0, 69)}…` : raw;
    return clipped.startsWith('Bundle') || clipped.startsWith('PC Bundle') ? clipped : `Bundle · ${clipped}`;
  }
  return `Bundle · ${partCount} items`;
}

function newBundleId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? `bundle-${crypto.randomUUID()}`
    : `bundle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Standalone parts → sold bundle shell (before Abrechnung link). */
export function createSoldBundleFromParts(
  parts: InventoryItem[],
  row: EbayTxRow
): { bundle: InventoryItem; parts: InventoryItem[] } | null {
  if (parts.length < 2) return null;
  if (parts.some((part) => part.isBundle || part.isPC)) return null;
  if (parts.some((part) => part.parentContainerId)) return null;

  const buySum = roundMoney(parts.reduce((sum, part) => sum + (Number(part.buyPrice) || 0), 0));
  const id = newBundleId();
  const name = bundleTitleFromOrder(row, parts.length);
  const bundle: InventoryItem = {
    id,
    name,
    buyPrice: buySum,
    buyDate: parts.reduce((earliest, part) => {
      const day = part.buyDate || '';
      return !earliest || (day && day < earliest) ? day : earliest;
    }, ''),
    category: 'Components',
    status: ItemStatus.SOLD,
    isBundle: true,
    componentIds: parts.map((part) => part.id),
    comment1: '',
    comment2: row.orderId ? `Sold bundle · eBay order ${row.orderId}` : 'Sold bundle from eBay Abrechnung',
    listedOnEbay: true,
    platformBought: 'Other',
    costOrigin: buildCostOrigin({
      kind: 'compose_bundle',
      addedAs: 'Abrechnung multi-link · sold bundle',
      lotTotalEur: buySum,
      allocatedEur: buySum,
      allocationMethod: 'manual',
      siblings: parts.map((part) => ({
        id: part.id,
        name: part.name,
        allocatedEur: roundMoney(Number(part.buyPrice) || 0),
      })),
      notes: `${parts.length} items · buyer total split equally on link`,
    }),
  };

  const nextParts = parts.map((part) => ({
    ...part,
    parentContainerId: id,
    status: ItemStatus.SOLD,
    ebayOrderId: undefined,
    ebayOrderLineKey: undefined,
    saleProceeds: undefined,
    containerSoldDate: undefined,
  }));

  return { bundle, parts: nextParts };
}

export type LinkMultipleEbayTxResult = {
  updates: InventoryItem[];
  bundle: InventoryItem;
};

/**
 * Link 2+ inventory items to one Bestellung as a sold bundle.
 * Buyer total and pocket are split equally across parts (Sheets ÷ N workflow).
 */
export function linkMultipleInventoryItemsToEbayTx(
  selected: InventoryItem[],
  row: EbayTxRow,
  ledger: EbayTxOrderLedger | null,
  taxMode: TaxMode,
  options?: { renameToOrderTitle?: boolean }
): LinkMultipleEbayTxResult | null {
  const unique = [...new Map(selected.map((item) => [item.id, item])).values()];
  const shell = createSoldBundleFromParts(unique, row);
  if (!shell) return null;

  const linkedBundle = linkInventoryItemToEbayTx(shell.bundle, row, ledger, taxMode, {
    ...options,
    useOrderTotal: true,
  });
  const synced = syncSoldContainerFamilyEqual(linkedBundle, shell.parts);
  const saleMeta = extractContainerSaleMeta(synced.container);
  const partsWithMeta = synced.children.map((child) => applyContainerSaleMetaToChild(child, saleMeta));

  return {
    bundle: synced.container,
    updates: [synced.container, ...partsWithMeta],
  };
}

/**
 * Link an existing PC/bundle Bestellung: bind CSV sale on the shell, then equal-split
 * buyer total / pocket onto every part and stamp the same CSV sell date.
 */
export function linkExistingContainerToEbayTx(
  container: InventoryItem,
  children: InventoryItem[],
  row: EbayTxRow,
  ledger: EbayTxOrderLedger | null,
  taxMode: TaxMode,
  options?: { renameToOrderTitle?: boolean }
): LinkMultipleEbayTxResult | null {
  if (!(container.isBundle || container.isPC) || children.length < 1) return null;

  const linkedBundle = linkInventoryItemToEbayTx(container, row, ledger, taxMode, {
    ...options,
    useOrderTotal: true,
  });
  const partsReady = children.map((child) => ({
    ...child,
    parentContainerId: container.id,
    // Nested sold parts stay in composition under the sold shell (inventory nest UI).
    status:
      child.status === ItemStatus.IN_STOCK || child.status === ItemStatus.ORDERED
        ? ItemStatus.IN_COMPOSITION
        : child.status,
  }));
  const synced = syncSoldContainerFamilyEqual(linkedBundle, partsReady);
  const saleMeta = extractContainerSaleMeta(synced.container);
  const sellDate = synced.container.sellDate;
  const partsWithMeta = synced.children.map((child) => ({
    ...applyContainerSaleMetaToChild(child, saleMeta),
    sellDate: sellDate || child.sellDate,
    containerSoldDate: undefined,
  }));

  return {
    bundle: synced.container,
    updates: [synced.container, ...partsWithMeta],
  };
}
