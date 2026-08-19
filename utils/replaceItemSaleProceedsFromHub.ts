/**
 * Replace screenshot / API-guess fee splits on linked sold items
 * with the Seller Hub archive breakdown.
 */

import { InventoryItem, ItemStatus, TaxMode, type SaleProceedsBreakdown } from '../types';
import type { EbayOrderLineItem, EbayOrderRecord } from '../services/ebayOrderIndex';
import { lineItemClaimKey, linkedEbayOrderRef } from './ebayOrderLinkAnalysis';
import { scoreItemAgainstOrderLine } from './ebayOrderMatch';
import {
  netPayoutAfterRefund,
  saleColumnSplit,
  saleProceedsFeeTotal,
  saleProceedsFromOrder,
  saleProceedsFromItemFields,
} from './saleProceeds';
import { orderHasFeeBreakdown } from '../services/ebayOrderIndex';
import { sumOrderRefundEur } from './ebayOrderFinancial';
import { roundMoney, computeItemProfitBeforeOverhead } from '../services/financialAggregation';
import { formatEUR } from './formatMoney';

const EPS = 0.02;

export type HubBreakdownReplaceReason = 'screenshot' | 'estimated' | 'missing' | 'differs';

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

function snapshot(item: InventoryItem, taxMode?: TaxMode): HubBreakdownSnapshot {
  const split = saleColumnSplit(item);
  const p = saleProceedsFromItemFields(item);
  return {
    ads: split?.adFeeEur ?? money(p.adFeeEur),
    ebay: split?.ebayFeeEur ?? money(p.transactionFeeEur),
    ship: split?.shippingEur ?? money(p.shippingLabelEur),
    refund: split?.refundEur ?? money(p.refundEur),
    net: split?.netEur ?? p.netPayoutEur ?? null,
    sell: item.sellPrice ?? null,
    total: split?.totalEur ?? p.buyerTotalEur ?? item.sellPrice ?? null,
    profit: taxMode ? computeItemProfitBeforeOverhead(item, taxMode) : item.profit ?? null,
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

function orderIdKey(id: string): string {
  return id.trim().toLowerCase().replace(/[\s_]/g, '');
}

export function pickHubLineForItem(order: EbayOrderRecord, item: InventoryItem): EbayOrderLineItem {
  const claim = (item.ebayOrderLineKey || '').trim().toLowerCase();
  if (claim) {
    const hit = order.lineItems.find((li) => lineItemClaimKey(order.orderId, li).toLowerCase() === claim);
    if (hit) return hit;
  }
  if (order.lineItems.length === 1) return order.lineItems[0];
  if (order.lineItems.length > 1) {
    const ranked = order.lineItems
      .map((li) => ({ li, score: scoreItemAgainstOrderLine(item, order, li).matchScore }))
      .sort((a, b) => b.score - a.score);
    if (ranked[0] && ranked[0].score > 0) return ranked[0].li;
    return ranked[0]?.li || order.lineItems[0];
  }
  return {
    sku: item.ebaySku || null,
    title: item.name,
    lineItemCost: order.grossTotal ?? item.sellPrice ?? null,
    listingId: item.ebayListingId || null,
  };
}

export function hubOrderIdFromItem(item: InventoryItem): string {
  const direct = (item.ebayOrderId || '').trim();
  if (direct) return direct;
  const raw = linkedEbayOrderRef(item);
  return raw.split('::')[0].trim();
}

export function hubBreakdownReplaceReason(
  item: InventoryItem,
  order: EbayOrderRecord,
  line: EbayOrderLineItem
): HubBreakdownReplaceReason | null {
  const refundEur = sumOrderRefundEur(order);
  if (!orderHasFeeBreakdown(order) && refundEur < 0.01) return null;
  const next = saleProceedsFromOrder(order, line);
  const cur = saleProceedsFromItemFields(item);
  if (!hubHasConcreteFees(next)) {
    if (refundEur < 0.01) return null;
    if (!item.saleProceeds) return 'missing';
    if (Math.abs(money(cur.refundEur) - refundEur) >= EPS) return 'differs';
    const afterNet = netPayoutAfterRefund(
      next.buyerTotalEur ?? cur.buyerTotalEur,
      saleProceedsFeeTotal(cur),
      cur.netPayoutEur,
      refundEur
    );
    if (afterNet != null && Math.abs(money(cur.netPayoutEur) - afterNet) >= EPS) return 'differs';
    return null;
  }
  if (!item.saleProceeds) return 'missing';
  if (cur.feesEstimated) return 'estimated';
  if (cur.source === 'ebay_screenshot' || cur.source === 'inferred') return 'screenshot';
  if (cur.source !== 'ebay_seller_hub' || proceedsDiffer(cur, next)) return 'differs';
  return null;
}

export function buildHubBreakdownReplacePlan(
  items: InventoryItem[],
  hubOrders: EbayOrderRecord[],
  taxMode: TaxMode
): HubBreakdownReplaceRow[] {
  const byId = new Map(hubOrders.map((o) => [orderIdKey(o.orderId), o]));
  const rows: HubBreakdownReplaceRow[] = [];
  for (const item of items) {
    if (item.status !== ItemStatus.SOLD && item.status !== ItemStatus.TRADED) continue;
    const orderId = hubOrderIdFromItem(item);
    if (!orderId) continue;
    const order = byId.get(orderIdKey(orderId));
    if (!order) continue;
    const line = pickHubLineForItem(order, item);
    const reason = hubBreakdownReplaceReason(item, order, line);
    if (!reason) continue;
    const nextItem = applyHubPayoutBreakdownToSoldItem(item, order, line, taxMode);
    rows.push({
      itemId: item.id,
      itemName: item.name,
      orderId: order.orderId,
      reason,
      before: snapshot(item, taxMode),
      after: snapshot(nextItem, taxMode),
      nextItem,
    });
  }
  return rows;
}

/**
 * Stamp Hub buyer-total + fee split onto an already-sold row.
 * Does not re-mark the sale, nest the item, or rewrite sellDate / membership.
 */
export function applyHubPayoutBreakdownToSoldItem(
  item: InventoryItem,
  order: EbayOrderRecord,
  line: EbayOrderLineItem,
  taxMode: TaxMode
): InventoryItem {
  const fromHub = saleProceedsFromOrder(order, line);
  const current = saleProceedsFromItemFields(item);
  const keepExistingFees = !hubHasConcreteFees(fromHub) && saleProceedsFeeTotal(current) >= 0.01;
  const refundEur = fromHub.refundEur ?? current.refundEur ?? 0;
  const feeSource = keepExistingFees ? current : fromHub;
  const feeTotal = saleProceedsFeeTotal(feeSource);
  const buyerTotal = fromHub.buyerTotalEur ?? current.buyerTotalEur ?? item.sellPrice ?? 0;
  const netPayoutEur = netPayoutAfterRefund(
    buyerTotal,
    feeTotal,
    keepExistingFees ? current.netPayoutEur : fromHub.netPayoutEur ?? current.netPayoutEur,
    refundEur ?? 0
  );
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
        ...fromHub,
        source: 'ebay_seller_hub',
        feesEstimated: false,
        refundEur: refundEur || null,
        netPayoutEur,
      };

  const next: InventoryItem = {
    ...item,
    status: item.status === ItemStatus.TRADED ? ItemStatus.TRADED : ItemStatus.SOLD,
    name: item.name,
    parentContainerId: item.parentContainerId,
    componentIds: item.componentIds,
    isPC: item.isPC,
    isBundle: item.isBundle,
    sellDate: item.sellDate,
    sellPrice: buyerTotal,
    ebayOrderId: item.ebayOrderId || order.orderId,
    ebayOrderLineKey: item.ebayOrderLineKey || lineItemClaimKey(order.orderId, line),
    hasFee: feeTotal >= 0.01,
    feeAmount: feeTotal,
    sellerPaidShipping: feeTotal >= 0.01 ? false : item.sellerPaidShipping,
    sellerShippingAmount: feeTotal >= 0.01 ? undefined : item.sellerShippingAmount,
    saleProceeds: proceedsHub,
  };
  return {
    ...next,
    profit: parseFloat(computeItemProfitBeforeOverhead(next, taxMode).toFixed(2)),
  };
}

/** Patches handleUpdate must receive — never the full inventory map. */
export function hubBreakdownItemsToSave(plan: HubBreakdownReplaceRow[]): InventoryItem[] {
  return plan.map((row) => row.nextItem);
}

export function hubBreakdownActionDetails(row: HubBreakdownReplaceRow): string {
  const bits = [
    row.orderId,
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
