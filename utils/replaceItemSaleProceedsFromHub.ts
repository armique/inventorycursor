/**
 * Replace screenshot / API-guess fee splits on linked sold items
 * with the Seller Hub archive breakdown.
 */

import { InventoryItem, ItemStatus, TaxMode, type SaleProceedsBreakdown } from '../types';
import type { EbayOrderLineItem, EbayOrderRecord } from '../services/ebayOrderIndex';
import { lineItemClaimKey } from './ebayOrderLinkAnalysis';
import {
  netPayoutAfterRefund,
  saleColumnSplit,
  saleProceedsFeeTotal,
  saleProceedsFromOrder,
  saleProceedsFromItemFields,
  type SaleColumnSplit,
} from './saleProceeds';
import { orderHasFeeBreakdown } from '../services/ebayOrderIndex';
import { sumOrderRefundEur } from './ebayOrderFinancial';
import { roundMoney, computeItemProfitBeforeOverhead, computeSoldTabMargin, buildInventoryLookup, getChildren, type InventoryLookup } from '../services/financialAggregation';
import { formatEUR } from './formatMoney';
import { customerFromEbayOrder } from './ebayOrderBuyerData';
import { shouldCorrectSalePlatformToEbay } from './applyEbayOrderMatch';
import {
  hubOrderIdFromItem,
  hubSaleColumnSplitForItem,
  mergeHubOrderLines,
  pickHubLinesForItem,
  saleProceedsFromOrderForItem,
  shouldSkipHubPlanForContainerChild,
  familyOwnsFullOrder,
  inventoryFamilyForHub,
  isHubContainer,
  usesFullOrderHubPayout,
} from './hubOrderProceeds';
import { hubReconciledFeeSplit } from './saleProceeds';
import { syncSoldContainerFamily } from './containerChildSoldDisplay';

export { hubOrderIdFromItem, pickHubLineForItem } from './hubOrderProceeds';

const EPS = 0.02;

export type HubBreakdownReplaceReason =
  | 'screenshot'
  | 'estimated'
  | 'missing'
  | 'differs'
  | 'order_meta';

export type HubBreakdownSnapshot = {
  ads: number;
  ebay: number;
  ship: number;
  refund: number;
  net: number | null;
  sell: number | null;
  total: number | null;
  profit: number | null;
  source: string;
};

export interface HubBreakdownReplaceRow {
  itemId: string;
  itemName: string;
  orderId: string;
  reason: HubBreakdownReplaceReason;
  before: HubBreakdownSnapshot;
  after: HubBreakdownSnapshot;
  nextItem: InventoryItem;
}

function money(n: number | null | undefined): number {
  return n != null && Number.isFinite(n) ? roundMoney(Math.abs(n)) : 0;
}

function blank(s: string | null | undefined): boolean {
  return !String(s || '').trim();
}

function itemHasCustomer(item: InventoryItem): boolean {
  const c = item.customer;
  if (!c) return false;
  return Boolean(
    String(c.name || '').trim() ||
      String(c.address || '').trim() ||
      String(c.email || '').trim() ||
      String(c.phone || '').trim()
  );
}

/** True when Hub has order/buyer fields the sold row is still missing. */
export function orderMetaNeedsHubFill(
  item: InventoryItem,
  order: EbayOrderRecord,
  line: EbayOrderLineItem
): boolean {
  if (blank(item.ebayOrderId) && order.orderId) return true;
  if (blank(item.ebayOrderLineKey) && order.orderId) return true;
  if (blank(item.ebayUsername) && order.buyer?.username) return true;
  if (blank(item.ebaySku) && line.sku) return true;
  if (blank(item.ebayListingId) && line.listingId) return true;
  if (blank(item.platformSold) || shouldCorrectSalePlatformToEbay(item)) return true;
  if (blank(item.paymentType) || shouldCorrectSalePlatformToEbay(item)) return true;
  const hubCustomer = customerFromEbayOrder(order);
  const hubHasBuyer = Boolean(
    hubCustomer.name || hubCustomer.address || hubCustomer.email || hubCustomer.phone
  );
  if (!itemHasCustomer(item) && hubHasBuyer) return true;
  return false;
}

/**
 * Fill blank order/buyer fields from Hub without clobbering values the user already typed.
 * Always anchors ebayOrderId / line key to this Hub order when applying a breakdown.
 */
export function fillMissingOrderMetaFromHub(
  item: InventoryItem,
  order: EbayOrderRecord,
  line: EbayOrderLineItem
): InventoryItem {
  const hubCustomer = customerFromEbayOrder(order);
  const hubHasBuyer = Boolean(
    hubCustomer.name || hubCustomer.address || hubCustomer.email || hubCustomer.phone
  );
  const fixPlatform = blank(item.platformSold) || shouldCorrectSalePlatformToEbay(item);
  const paymentType =
    fixPlatform || blank(item.paymentType) ? 'ebay.de' : item.paymentType;

  return {
    ...item,
    ebayOrderId: blank(item.ebayOrderId) ? order.orderId : item.ebayOrderId,
    ebayOrderLineKey: blank(item.ebayOrderLineKey)
      ? order.lineItems.length <= 1 || !isHubContainer(item)
        ? lineItemClaimKey(order.orderId, line)
        : item.ebayOrderLineKey
      : item.ebayOrderLineKey,
    ebayUsername: blank(item.ebayUsername) ? order.buyer?.username || item.ebayUsername : item.ebayUsername,
    ebaySku: blank(item.ebaySku) ? line.sku || item.ebaySku : item.ebaySku,
    ebayListingId: blank(item.ebayListingId) ? line.listingId || item.ebayListingId : item.ebayListingId,
    platformSold: fixPlatform ? 'ebay.de' : item.platformSold,
    paymentType,
    customer: !itemHasCustomer(item) && hubHasBuyer ? hubCustomer : item.customer,
    // Never stamp sellDate from Hub import/creation — use Abrechnung CSV backfill or manual Sold tab.
    sellDate: item.sellDate,
  };
}

function snapshot(item: InventoryItem, taxMode?: TaxMode): HubBreakdownSnapshot {
  const split = saleColumnSplit(item);
  const p = saleProceedsFromItemFields(item);
  return {
    ads: split?.adFeeEur ?? money(p.adFeeEur),
    ebay: split?.ebayFeeEur ?? money(p.transactionFeeEur),
    ship: split?.shippingEur ?? money(p.shippingLabelEur),
    refund: split?.refundEur ?? money(p.refundEur),
    net: p.netPayoutEur ?? split?.netEur ?? null,
    sell: item.sellPrice ?? null,
    total: p.buyerTotalEur ?? item.sellPrice ?? split?.totalEur ?? null,
    profit: taxMode === 'SmallBusiness' || !taxMode
      ? computeSoldTabMargin(item)
      : computeItemProfitBeforeOverhead(item, taxMode),
    source: p.feesEstimated ? 'estimated' : p.source || 'inferred',
  };
}

function proceedsDiffer(a: SaleProceedsBreakdown, b: SaleProceedsBreakdown): boolean {
  const keys: Array<keyof SaleProceedsBreakdown> = [
    'buyerTotalEur',
    'transactionFeeEur',
    'adFeeEur',
    'shippingLabelEur',
    'otherFeeEur',
    'refundEur',
    'netPayoutEur',
  ];
  return keys.some((k) => Math.abs(money(a[k] as number) - money(b[k] as number)) >= EPS);
}

function hubHasConcreteFees(p: SaleProceedsBreakdown | null | undefined): boolean {
  return Boolean(p) && !p!.feesEstimated && saleProceedsFeeTotal(p) >= 0.01;
}

function feeBucketsFilled(p: {
  transactionFeeEur?: number | null;
  adFeeEur?: number | null;
  shippingLabelEur?: number | null;
}): number {
  return [p.transactionFeeEur, p.adFeeEur, p.shippingLabelEur].filter((n) => money(n) >= 0.01).length;
}

/**
 * Item already has ads/label/eBay lines that add up to Hub's payout.
 * Hub sometimes only parsed a single lump "eBay" fee — do not wipe the detail.
 */
export function itemFeeSplitIsRicherAndReconcilesToHub(
  itemProceeds: SaleProceedsBreakdown,
  hubProceeds: SaleProceedsBreakdown
): boolean {
  if (Math.abs(money(itemProceeds.buyerTotalEur) - money(hubProceeds.buyerTotalEur)) >= EPS) return false;
  if (Math.abs(money(itemProceeds.netPayoutEur) - money(hubProceeds.netPayoutEur)) >= EPS) return false;
  if (Math.abs(saleProceedsFeeTotal(itemProceeds) - saleProceedsFeeTotal(hubProceeds)) >= EPS) return false;
  if (feeBucketsFilled(itemProceeds) <= feeBucketsFilled(hubProceeds)) return false;
  return money(itemProceeds.adFeeEur) >= 0.01 || money(itemProceeds.shippingLabelEur) >= 0.01;
}

function orderIdKey(id: string): string {
  return id.trim().toLowerCase().replace(/[\s_]/g, '');
}

export function indexHubOrdersById(hubOrders: EbayOrderRecord[]): Map<string, EbayOrderRecord> {
  return new Map(hubOrders.map((o) => [orderIdKey(o.orderId), o]));
}

export function hubBreakdownReplaceReason(
  item: InventoryItem,
  order: EbayOrderRecord,
  line: EbayOrderLineItem,
  items?: InventoryItem[],
  lookup?: InventoryLookup
): HubBreakdownReplaceReason | null {
  const refundEur = sumOrderRefundEur(order);
  const metaGap = orderMetaNeedsHubFill(item, order, line);
  if (!orderHasFeeBreakdown(order) && refundEur < 0.01) {
    return metaGap ? 'order_meta' : null;
  }
  const next = items?.length
    ? saleProceedsFromOrderForItem(order, item, items, lookup)
    : saleProceedsFromOrder(order, line);
  const cur = saleProceedsFromItemFields(item);
  if (!hubHasConcreteFees(next)) {
    if (refundEur < 0.01) return metaGap ? 'order_meta' : null;
    if (!item.saleProceeds) return 'missing';
    if (Math.abs(money(cur.refundEur) - refundEur) >= EPS) return 'differs';
    const afterNet = netPayoutAfterRefund(
      next.buyerTotalEur ?? cur.buyerTotalEur,
      saleProceedsFeeTotal(cur),
      cur.netPayoutEur,
      refundEur
    );
    if (afterNet != null && Math.abs(money(cur.netPayoutEur) - afterNet) >= EPS) return 'differs';
    return metaGap ? 'order_meta' : null;
  }
  if (itemFeeSplitIsRicherAndReconcilesToHub(cur, next)) {
    return metaGap ? 'order_meta' : null;
  }
  if (!item.saleProceeds) return 'missing';
  if (cur.feesEstimated) return 'estimated';
  if (cur.source === 'ebay_screenshot' || cur.source === 'inferred') return 'screenshot';
  const gross = cur.buyerTotalEur ?? item.sellPrice;
  if (
    cur.source === 'ebay_seller_hub' &&
    gross != null &&
    cur.netPayoutEur != null &&
    Math.abs(cur.netPayoutEur - gross) < EPS &&
    saleProceedsFeeTotal(cur) >= 0.01
  ) {
    return 'differs';
  }
  if (cur.source !== 'ebay_seller_hub' || proceedsDiffer(cur, next)) return 'differs';
  return metaGap ? 'order_meta' : null;
}

export type HubSellDisplayRow = {
  itemId: string;
  orderId: string;
  previewItem: InventoryItem;
  replaceRow: HubBreakdownReplaceRow | null;
};

/** Hub sell column preview for sold rows that still need linking to the Sell cell. */
export function buildHubSellDisplayByItemId(
  items: InventoryItem[],
  hubOrders: EbayOrderRecord[],
  taxMode: TaxMode,
  lookup: InventoryLookup = buildInventoryLookup(items)
): Map<string, HubSellDisplayRow> {
  return buildHubSellMaps(items, hubOrders, taxMode, lookup).display;
}

export function buildHubSellMaps(
  items: InventoryItem[],
  hubOrders: EbayOrderRecord[],
  taxMode: TaxMode,
  lookup: InventoryLookup = buildInventoryLookup(items)
): {
  replace: Map<string, HubBreakdownReplaceRow>;
  display: Map<string, HubSellDisplayRow>;
} {
  const byId = indexHubOrdersById(hubOrders);
  const plan = buildHubBreakdownReplacePlan(items, hubOrders, taxMode, lookup);
  const replace = new Map(plan.map((row) => [row.itemId, row]));
  const display = new Map<string, HubSellDisplayRow>();

  for (const item of items) {
    if (item.status !== ItemStatus.SOLD && item.status !== ItemStatus.TRADED) continue;
    if (shouldSkipHubPlanForContainerChild(item, items, lookup)) continue;
    const orderId = hubOrderIdFromItem(item);
    if (!orderId) continue;
    const order = byId.get(orderIdKey(orderId));
    if (!order) continue;
    if (!hubSellCellNeedsLink(item, order, items, lookup)) continue;

    const replaceRow = replace.get(item.id) ?? null;
    const previewItem =
      replaceRow?.nextItem ??
      applyHubPayoutBreakdownToSoldItem(
        item,
        order,
        mergeHubOrderLines(pickHubLinesForItem(order, item, items, lookup)),
        taxMode,
        items,
        lookup
      );

    display.set(item.id, {
      itemId: item.id,
      orderId: order.orderId,
      previewItem,
      replaceRow,
    });
  }
  return { replace, display };
}

export function buildHubBreakdownReplacePlan(
  items: InventoryItem[],
  hubOrders: EbayOrderRecord[],
  taxMode: TaxMode,
  lookup: InventoryLookup = buildInventoryLookup(items)
): HubBreakdownReplaceRow[] {
  const byId = indexHubOrdersById(hubOrders);
  const rows: HubBreakdownReplaceRow[] = [];
  for (const item of items) {
    const row = buildHubBreakdownReplaceRowForItem(item, items, byId, taxMode, lookup);
    if (row) rows.push(row);
  }
  return rows;
}

/** One sold row vs Hub archive — used by the full plan and by idle chunked auto-heal. */
export function buildHubBreakdownReplaceRowForItem(
  item: InventoryItem,
  items: InventoryItem[],
  hubOrdersById: Map<string, EbayOrderRecord>,
  taxMode: TaxMode,
  lookup?: InventoryLookup
): HubBreakdownReplaceRow | null {
  if (item.status !== ItemStatus.SOLD && item.status !== ItemStatus.TRADED) return null;
  if (shouldSkipHubPlanForContainerChild(item, items, lookup)) return null;
  const orderId = hubOrderIdFromItem(item);
  if (!orderId) return null;
  const order = hubOrdersById.get(orderIdKey(orderId));
  if (!order) return null;
  const lines = pickHubLinesForItem(order, item, items, lookup);
  const line = mergeHubOrderLines(lines);
  const reason = hubBreakdownReplaceReason(item, order, line, items, lookup);
  if (!reason) return null;
  const nextItem = applyHubPayoutBreakdownToSoldItem(item, order, line, taxMode, items, lookup);
  return {
    itemId: item.id,
    itemName: item.name,
    orderId: order.orderId,
    reason,
    before: snapshot(item, taxMode),
    after: snapshot(nextItem, taxMode),
    nextItem,
  };
}

/**
 * Stamp Hub buyer-total + fee split onto an already-sold row.
 * Also fills missing order/buyer fields (username, customer, SKU, platform).
 * Does not re-mark the sale, nest the item, or rewrite an existing sellDate.
 */
export function applyHubPayoutBreakdownToSoldItem(
  item: InventoryItem,
  order: EbayOrderRecord,
  line: EbayOrderLineItem,
  taxMode: TaxMode,
  allItems?: InventoryItem[],
  lookup?: InventoryLookup
): InventoryItem {
  const fromHub = saleProceedsFromOrderForItem(order, item, allItems, lookup);
  const withMeta = fillMissingOrderMetaFromHub(item, order, line);
  const normalized = order;
  const family = allItems?.length ? inventoryFamilyForHub(item, allItems, lookup) : [item];
  const fullOrderShare = usesFullOrderHubPayout(normalized, item, allItems, lookup);
  const hubFees = hubReconciledFeeSplit(normalized);
  const current = saleProceedsFromItemFields(withMeta);
  const hubFeeProceeds: SaleProceedsBreakdown = fullOrderShare
    ? {
        capturedAt: withMeta.saleProceeds?.capturedAt || new Date().toISOString(),
        source: 'ebay_seller_hub',
        itemGrossEur: hubFees.itemGrossEur,
        buyerShippingEur: hubFees.buyerShippingEur,
        buyerTotalEur: hubFees.buyerTotalEur,
        transactionFeeEur: hubFees.transactionFeeEur,
        adFeeEur: hubFees.adFeeEur,
        shippingLabelEur: hubFees.shippingLabelEur,
        otherFeeEur: hubFees.otherFeeEur,
        refundEur: hubFees.refundEur,
        netPayoutEur: hubFees.netPayoutEur,
        feesEstimated: false,
      }
    : fromHub;
  const keepExistingFees =
    (!hubHasConcreteFees(hubFeeProceeds) && saleProceedsFeeTotal(current) >= 0.01) ||
    itemFeeSplitIsRicherAndReconcilesToHub(current, hubFeeProceeds);
  const refundEur = fromHub.refundEur ?? current.refundEur ?? 0;
  const feeSource = keepExistingFees ? current : fullOrderShare ? hubFees : fromHub;
  const feeTotal = saleProceedsFeeTotal(feeSource);
  const buyerTotal =
    (fullOrderShare ? hubFees.buyerTotalEur : fromHub.buyerTotalEur) ??
    fromHub.buyerTotalEur ??
    current.buyerTotalEur ??
    withMeta.sellPrice ??
    0;
  const netPayoutEur = fullOrderShare ? hubFees.netPayoutEur : fromHub.netPayoutEur;
  const feeSplit = fullOrderShare ? hubFees : fromHub;
  const proceedsHub: SaleProceedsBreakdown = keepExistingFees
    ? {
        ...current,
        capturedAt: new Date().toISOString(),
        source: 'ebay_seller_hub',
        feesEstimated: false,
        buyerTotalEur: buyerTotal,
        refundEur: refundEur || null,
        netPayoutEur,
      }
    : {
        capturedAt: new Date().toISOString(),
        source: 'ebay_seller_hub',
        feesEstimated: false,
        itemGrossEur: feeSplit.itemGrossEur ?? fromHub.itemGrossEur,
        buyerShippingEur: feeSplit.buyerShippingEur ?? fromHub.buyerShippingEur,
        buyerTotalEur: buyerTotal,
        transactionFeeEur:
          feeSplit.transactionFeeEur != null && feeSplit.transactionFeeEur >= 0.01
            ? feeSplit.transactionFeeEur
            : null,
        adFeeEur:
          feeSplit.adFeeEur != null && feeSplit.adFeeEur >= 0.01 ? feeSplit.adFeeEur : null,
        shippingLabelEur:
          feeSplit.shippingLabelEur != null && feeSplit.shippingLabelEur >= 0.01
            ? feeSplit.shippingLabelEur
            : null,
        otherFeeEur:
          feeSplit.otherFeeEur != null && feeSplit.otherFeeEur >= 0.01 ? feeSplit.otherFeeEur : null,
        refundEur: refundEur || null,
        netPayoutEur,
      };

  const next: InventoryItem = {
    ...withMeta,
    status: withMeta.status === ItemStatus.TRADED ? ItemStatus.TRADED : ItemStatus.SOLD,
    name: withMeta.name,
    parentContainerId: withMeta.parentContainerId,
    componentIds: withMeta.componentIds,
    isPC: withMeta.isPC,
    isBundle: withMeta.isBundle,
    sellDate: withMeta.sellDate,
    sellPrice: buyerTotal,
    ebayOrderId: withMeta.ebayOrderId || order.orderId,
    ebayOrderLineKey: withMeta.ebayOrderLineKey || lineItemClaimKey(order.orderId, line),
    hasFee: feeTotal >= 0.01,
    feeAmount: feeTotal,
    sellerPaidShipping: feeTotal >= 0.01 ? false : withMeta.sellerPaidShipping,
    sellerShippingAmount: feeTotal >= 0.01 ? undefined : withMeta.sellerShippingAmount,
    saleProceeds: proceedsHub,
  };
  return {
    ...next,
    // Sold-tab margin is always net − EK; taxMode still used for Diff/VAT callers.
    profit: parseFloat(
      (taxMode === 'SmallBusiness'
        ? computeSoldTabMargin(next)
        : computeItemProfitBeforeOverhead(next, taxMode)
      ).toFixed(2)
    ),
  };
}

/** True when the stored sell cell differs from the Hub order split. */
export function hubSellSplitDiffersFromItem(item: InventoryItem, hubSplit: SaleColumnSplit): boolean {
  const itemSplit = saleColumnSplit(item, {
    displaySellEur: item.saleProceeds?.buyerTotalEur ?? item.sellPrice,
  });
  if (!itemSplit) return true;
  const fields: Array<keyof SaleColumnSplit> = [
    'totalEur',
    'netEur',
    'shippingEur',
    'ebayFeeEur',
    'adFeeEur',
    'otherFeeEur',
  ];
  return fields.some((key) => Math.abs((itemSplit[key] as number) - (hubSplit[key] as number)) >= EPS);
}

/**
 * Hub sell column is shown only while the Sell cell still needs linking.
 * Hide once amounts match Hub and the row is stamped from Seller Hub.
 */
export function hubSellCellNeedsLink(
  item: InventoryItem,
  order: EbayOrderRecord,
  items?: InventoryItem[],
  lookup?: InventoryLookup
): boolean {
  const hubSplit = hubSaleColumnSplitForItem(order, item, items, lookup);
  const cur = saleProceedsFromItemFields(item);
  const hubProceeds: SaleProceedsBreakdown = {
    capturedAt: cur.capturedAt || new Date().toISOString(),
    source: 'ebay_seller_hub',
    buyerTotalEur: hubSplit.totalEur,
    transactionFeeEur: hubSplit.ebayFeeEur,
    adFeeEur: hubSplit.adFeeEur,
    shippingLabelEur: hubSplit.shippingEur,
    otherFeeEur: hubSplit.otherFeeEur,
    refundEur: hubSplit.refundEur,
    netPayoutEur: hubSplit.netEur,
    feesEstimated: false,
  };
  if (itemFeeSplitIsRicherAndReconcilesToHub(cur, hubProceeds)) return false;
  if (hubSellSplitDiffersFromItem(item, hubSplit)) return true;
  return cur.source !== 'ebay_seller_hub' || Boolean(cur.feesEstimated);
}

/** Build an apply row from Hub order data — used when the sell cell should mirror Hub sell. */
export function buildHubApplyRowForItem(
  item: InventoryItem,
  order: EbayOrderRecord,
  taxMode: TaxMode,
  allItems?: InventoryItem[],
  reason: HubBreakdownReplaceReason = 'differs',
  lookup?: InventoryLookup
): HubBreakdownReplaceRow {
  const lines = pickHubLinesForItem(order, item, allItems, lookup);
  const line = mergeHubOrderLines(lines);
  const nextItem = applyHubPayoutBreakdownToSoldItem(item, order, line, taxMode, allItems, lookup);
  return {
    itemId: item.id,
    itemName: item.name,
    orderId: order.orderId,
    reason,
    before: snapshot(item, taxMode),
    after: snapshot(nextItem, taxMode),
    nextItem,
  };
}

/** Patches handleUpdate must receive — never the full inventory map. */
export function hubBreakdownItemsToSave(
  plan: HubBreakdownReplaceRow[],
  allItems?: InventoryItem[]
): InventoryItem[] {
  const out: InventoryItem[] = [];
  const seen = new Set<string>();
  for (const row of plan) {
    const parent = row.nextItem;
    if (!allItems?.length || !(parent.isPC || parent.isBundle)) {
      out.push(parent);
      seen.add(parent.id);
      continue;
    }
    const kids = getChildren(parent, allItems);
    const synced = syncSoldContainerFamily(parent, kids);
    out.push(synced.container);
    seen.add(synced.container.id);
    for (let i = 0; i < kids.length; i++) {
      if (synced.children[i] === kids[i] || seen.has(synced.children[i].id)) continue;
      seen.add(synced.children[i].id);
      out.push(synced.children[i]);
    }
  }
  return out;
}

export function hubBreakdownActionDetails(row: HubBreakdownReplaceRow): string {
  const bits = [
    row.orderId,
    row.nextItem.ebayUsername ? `@${row.nextItem.ebayUsername}` : null,
    row.nextItem.customer?.name ? `buyer ${row.nextItem.customer.name}` : null,
    row.after.total != null ? `buyer €${formatEUR(row.after.total)}` : null,
    `ads €${formatEUR(row.after.ads)}`,
    `eBay €${formatEUR(row.after.ebay)}`,
    `label €${formatEUR(row.after.ship)}`,
    row.after.refund >= 0.01 ? `refund €${formatEUR(row.after.refund)}` : null,
    row.after.net != null ? `net €${formatEUR(row.after.net)}` : null,
    row.after.profit != null ? `margin €${formatEUR(row.after.profit)}` : null,
    row.nextItem.sellDate ? `sold ${row.nextItem.sellDate}` : null,
  ].filter(Boolean);
  return bits.join(' · ');
}

export function applyHubBreakdownReplacePlan(
  items: InventoryItem[],
  plan: HubBreakdownReplaceRow[]
): InventoryItem[] {
  const next = new Map(plan.map((row) => [row.itemId, row.nextItem]));
  return items.map((item) => next.get(item.id) || item);
}

export type HubMarginMathCheck = {
  netEur: number | null;
  buyPriceEur: number;
  expectedMarginEur: number | null;
  storedMarginEur: number | null;
  matches: boolean;
};

/** True when Hub net − buy price equals the margin that would be stamped on apply. */
export function hubMarginMathCheck(
  item: InventoryItem,
  split: SaleColumnSplit,
  taxMode: TaxMode = POCKET_PROFIT_TAX_MODE
): HubMarginMathCheck {
  const buyPriceEur = roundMoney(Number(item.buyPrice) || 0);
  const netEur =
    split.netEur != null && Number.isFinite(split.netEur) ? roundMoney(split.netEur) : null;
  const expectedMarginEur =
    netEur != null ? roundMoney(netEur - buyPriceEur) : null;
  const storedMarginEur =
    item.profit != null && Number.isFinite(Number(item.profit))
      ? roundMoney(Number(item.profit))
      : null;
  const matches =
    expectedMarginEur != null &&
    (storedMarginEur == null || Math.abs(expectedMarginEur - storedMarginEur) < EPS);
  return { netEur, buyPriceEur, expectedMarginEur, storedMarginEur, matches };
}

export function hubMarginMathCheckForRow(
  item: InventoryItem,
  split: SaleColumnSplit,
  row: HubBreakdownReplaceRow,
  taxMode: TaxMode = POCKET_PROFIT_TAX_MODE
): HubMarginMathCheck {
  const buyPriceEur = roundMoney(Number(item.buyPrice) || 0);
  const netEur =
    row.after.net != null && Number.isFinite(row.after.net) ? roundMoney(row.after.net) : null;
  const expectedMarginEur =
    netEur != null ? roundMoney(netEur - buyPriceEur) : null;
  const afterMargin = roundMoney(computeSoldTabMargin(row.nextItem));
  const matches =
    expectedMarginEur != null && Math.abs(expectedMarginEur - afterMargin) < EPS;
  return {
    netEur,
    buyPriceEur,
    expectedMarginEur,
    storedMarginEur: afterMargin,
    matches,
  };
}

/** Sold rows that should receive Hub archive values without a manual cell click. */
export function hubBreakdownRowsNeedingAutoApply(plan: HubBreakdownReplaceRow[]): HubBreakdownReplaceRow[] {
  return plan.filter((row) => {
    if (row.reason === 'order_meta') return false;
    if (row.after.net == null && row.reason !== 'missing' && row.reason !== 'estimated') {
      return false;
    }
    const beforeNet = row.before.net;
    const afterNet = row.after.net;
    if (beforeNet != null && afterNet != null && Math.abs(beforeNet - afterNet) >= EPS) {
      return true;
    }
    const beforeTotal = row.before.total;
    const afterTotal = row.after.total;
    if (
      beforeTotal != null &&
      afterTotal != null &&
      Math.abs(beforeTotal - afterTotal) >= EPS
    ) {
      return true;
    }
    if (
      Math.abs(row.before.ads - row.after.ads) >= EPS ||
      Math.abs(row.before.ebay - row.after.ebay) >= EPS ||
      Math.abs(row.before.ship - row.after.ship) >= EPS
    ) {
      return true;
    }
    if (row.reason === 'missing' || row.reason === 'estimated' || row.reason === 'screenshot') {
      return true;
    }
    if (row.before.source !== 'ebay_seller_hub' && row.reason === 'differs') return true;
    return false;
  });
}
