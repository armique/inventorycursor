/**
 * Resolve which eBay order lines belong to an inventory row (incl. sold bundles)
 * and build order-level Hub proceeds — never hang half an order on one bundle row.
 */
import type { InventoryItem, SaleProceedsBreakdown } from '../types';
import type { EbayOrderLineItem, EbayOrderRecord } from '../services/ebayOrderIndex';
import {
  getChildren,
  isSoldWithProportionalChildren,
  roundMoney,
  type InventoryLookup,
} from '../services/financialAggregation';
import { normalizeHubOrderForProceeds } from './ebayOrderFinancial';
import { isRealizedDisposal } from './itemDisposition';
import { lineItemClaimKey, linkedEbayOrderRef } from './ebayOrderLinkAnalysis';
import { scoreItemAgainstOrderLine } from './ebayOrderMatch';
import { saleProceedsFromOrder, hubSaleColumnSplit, hubReconciledFeeSplit, type SaleColumnSplit } from './saleProceeds';

const TITLE_MATCH_MIN = 40;
const ORDER_GROSS_EPS = 0.06;

function orderIdNorm(id: string): string {
  return id.trim().toLowerCase().replace(/[\s_]/g, '');
}

export function hubOrderIdFromItem(item: InventoryItem): string {
  const direct = (item.ebayOrderId || '').trim();
  if (direct) return direct;
  const raw = linkedEbayOrderRef(item);
  return raw.split('::')[0].trim();
}

function itemOnOrder(item: InventoryItem, order: EbayOrderRecord): boolean {
  const oid = hubOrderIdFromItem(item);
  if (!oid) return true;
  return orderIdNorm(oid) === orderIdNorm(order.orderId);
}

function itemLinkedToHubOrder(item: InventoryItem, order: EbayOrderRecord): boolean {
  const oid = hubOrderIdFromItem(item);
  return Boolean(oid && orderIdNorm(oid) === orderIdNorm(order.orderId));
}

/** Sold/traded inventory rows on this order (bundle shells count; nested parts skipped). */
export function soldInventoryRowsOnOrder(
  orderId: string,
  items: InventoryItem[],
  lookup?: InventoryLookup
): InventoryItem[] {
  const key = orderIdNorm(orderId);
  return items.filter((row) => {
    if (!isRealizedDisposal(row)) return false;
    if (shouldSkipHubPlanForContainerChild(row, items, lookup)) return false;
    const oid = hubOrderIdFromItem(row);
    return Boolean(oid && orderIdNorm(oid) === key);
  });
}

/** PC builds, lot bundles, mixed bundles with componentIds. */
export function isHubContainer(item: InventoryItem): boolean {
  return Boolean(
    item.isPC || item.isBundle || (item.componentIds && item.componentIds.length > 0)
  );
}

/** Full eBay checkout payout — not a line-item proration — for this inventory row. */
export function usesFullOrderHubPayout(
  order: EbayOrderRecord,
  item: InventoryItem,
  items?: InventoryItem[],
  lookup?: InventoryLookup
): boolean {
  if (!itemLinkedToHubOrder(item, order)) return false;
  if (isHubContainer(item)) return true;
  const family = items?.length ? inventoryFamilyForHub(item, items, lookup) : [item];
  if (familyOwnsFullOrder(order, family, items, lookup)) return true;
  return (order.lineItems?.length ?? 0) <= 1;
}

function familySellTotal(
  family: InventoryItem[],
  items?: InventoryItem[],
  lookup?: InventoryLookup
): number {
  const root = family.find((row) => isHubContainer(row) && isRealizedDisposal(row));
  if (root && items?.length) {
    if (isSoldWithProportionalChildren(root, items, lookup)) {
      return roundMoney(
        getChildren(root, items, lookup)
          .filter(isRealizedDisposal)
          .reduce((s, row) => s + (Number(row.sellPrice) || 0), 0)
      );
    }
    const parentSell = Number(root.sellPrice) || 0;
    if (parentSell > 0.01) return roundMoney(parentSell);
  }
  return roundMoney(
    family.filter(isRealizedDisposal).reduce((s, row) => s + (Number(row.sellPrice) || 0), 0)
  );
}

/** True when this inventory family owns the full multi-line checkout gross. */
export function familyOwnsFullOrder(
  order: EbayOrderRecord,
  family: InventoryItem[],
  items?: InventoryItem[],
  lookup?: InventoryLookup
): boolean {
  if (!order.lineItems?.length || order.lineItems.length <= 1) return false;
  const orderGross = roundMoney(Number(order.grossTotal) || 0);
  if (orderGross <= 0.01) return false;
  const familySell = familySellTotal(family, items, lookup);
  return Math.abs(familySell - orderGross) <= ORDER_GROSS_EPS;
}

/** Parent + nested parts when this row is (or sits under) a sold bundle/PC. */
export function inventoryFamilyForHub(
  item: InventoryItem,
  items: InventoryItem[],
  lookup?: InventoryLookup
): InventoryItem[] {
  let root = item;
  if (item.parentContainerId) {
    const parent = lookup?.itemById.get(item.parentContainerId)
      ?? items.find((i) => i.id === item.parentContainerId);
    if (parent && isHubContainer(parent)) root = parent;
  }
  if (isHubContainer(root) && isRealizedDisposal(root)) {
    const kids = getChildren(root, items, lookup);
    return [root, ...kids];
  }
  return [item];
}

/** Skip hub plan on nested parts when the sold container row owns the same order. */
export function shouldSkipHubPlanForContainerChild(
  item: InventoryItem,
  items: InventoryItem[],
  lookup?: InventoryLookup
): boolean {
  if (!item.parentContainerId) return false;
  const parent = lookup?.itemById.get(item.parentContainerId)
    ?? items.find((i) => i.id === item.parentContainerId);
  if (!parent || !isHubContainer(parent)) return false;
  if (!isRealizedDisposal(parent)) return false;
  if (!isSoldWithProportionalChildren(parent, items, lookup)) return false;
  const parentOrder = hubOrderIdFromItem(parent);
  if (!parentOrder) return true;
  const childOrder = hubOrderIdFromItem(item);
  return !childOrder || orderIdNorm(childOrder) === orderIdNorm(parentOrder);
}

/**
 * All order lines that belong to this inventory row.
 * Multi-line checkouts: bundle families match every relevant line, not just the best-scoring one.
 */
export function pickHubLinesForItem(
  order: EbayOrderRecord,
  item: InventoryItem,
  items?: InventoryItem[],
  lookup?: InventoryLookup
): EbayOrderLineItem[] {
  if (!order.lineItems.length) {
    const gross = Number(order.grossTotal) || 0;
    const ship = Number(order.shippingCost) || 0;
    const itemCost =
      gross > 0.01 && ship >= 0.01 && gross > ship + 0.05
        ? roundMoney(gross - ship)
        : order.grossTotal ?? item.sellPrice ?? null;
    return [
      {
        sku: item.ebaySku || null,
        title: item.name,
        lineItemCost: itemCost,
        listingId: item.ebayListingId || null,
      },
    ];
  }

  const family = items?.length ? inventoryFamilyForHub(item, items, lookup) : [item];
  const ownsFullOrder = familyOwnsFullOrder(order, family, items, lookup);

  const claim = (item.ebayOrderLineKey || '').trim().toLowerCase();
  if (claim && !ownsFullOrder) {
    const hit = order.lineItems.find(
      (li) => lineItemClaimKey(order.orderId, li).toLowerCase() === claim
    );
    if (hit) return [hit];
  }

  if (order.lineItems.length === 1) return [order.lineItems[0]];

  if (ownsFullOrder) return [...order.lineItems];

  const familyOnOrder = family.filter((row) => itemOnOrder(row, order));

  const matched: EbayOrderLineItem[] = [];
  const seen = new Set<string>();
  for (const line of order.lineItems) {
    const key = lineItemClaimKey(order.orderId, line);
    let best = 0;
    for (const row of familyOnOrder.length ? familyOnOrder : family) {
      best = Math.max(best, scoreItemAgainstOrderLine(row, order, line).matchScore);
    }
    if (best >= TITLE_MATCH_MIN && !seen.has(key)) {
      seen.add(key);
      matched.push(line);
    }
  }

  if (matched.length > 0) {
    if (ownsFullOrder && matched.length < order.lineItems.length) return [...order.lineItems];
    return matched;
  }

  const ranked = order.lineItems
    .map((li) => ({ li, score: scoreItemAgainstOrderLine(item, order, li).matchScore }))
    .sort((a, b) => b.score - a.score);
  if (ranked[0] && ranked[0].score > 0) return [ranked[0].li];
  return [order.lineItems[0]];
}

/** Merge multiple checkout lines into one synthetic line for proration (sums gross). */
export function mergeHubOrderLines(lines: EbayOrderLineItem[]): EbayOrderLineItem {
  if (lines.length === 1) return lines[0];
  const gross = lines.reduce((sum, li) => sum + (Number(li.lineItemCost) || 0), 0);
  return {
    sku: lines.find((l) => l.sku)?.sku ?? lines[0]?.sku ?? null,
    title: lines.map((l) => l.title || l.sku || 'item').join(' · '),
    lineItemCost: gross > 0 ? gross : null,
    listingId: lines.find((l) => l.listingId)?.listingId ?? lines[0]?.listingId ?? null,
  };
}

/** Hub sell column for one inventory row — order-level Gesamtbetrag / Bestelleinnahmen. */
export function hubSaleColumnSplitForItem(
  order: EbayOrderRecord,
  item: InventoryItem,
  items?: InventoryItem[],
  lookup?: InventoryLookup
): SaleColumnSplit {
  const normalized = normalizeHubOrderForProceeds(order);
  if (usesFullOrderHubPayout(normalized, item, items, lookup)) {
    return hubSaleColumnSplit(normalized, 1);
  }
  const family = items?.length ? inventoryFamilyForHub(item, items, lookup) : [item];
  const lines = pickHubLinesForItem(normalized, item, items, lookup);
  const merged = mergeHubOrderLines(lines);
  const fromLines = normalized.lineItems.reduce((sum, li) => sum + (Number(li.lineItemCost) || 0), 0);
  const lineGross = Number(merged.lineItemCost) || 0;
  const share =
    familyOwnsFullOrder(normalized, family, items, lookup) || fromLines <= 0.01 || lineGross <= 0
      ? 1
      : lineGross / fromLines;
  return hubSaleColumnSplit(normalized, share);
}

/** Hub Bestelleinnahmen for one inventory row — full order share for multi-part bundles. */
export function saleProceedsFromOrderForItem(
  order: EbayOrderRecord,
  item: InventoryItem,
  items?: InventoryItem[],
  lookup?: InventoryLookup
): SaleProceedsBreakdown {
  const normalized = normalizeHubOrderForProceeds(order);
  if (usesFullOrderHubPayout(normalized, item, items, lookup)) {
    const f = hubReconciledFeeSplit(normalized);
    return {
      capturedAt: new Date().toISOString(),
      source: 'ebay_seller_hub',
      itemGrossEur: f.itemGrossEur,
      buyerShippingEur: f.buyerShippingEur,
      buyerTotalEur: f.buyerTotalEur,
      transactionFeeEur: f.transactionFeeEur >= 0.01 ? f.transactionFeeEur : null,
      adFeeEur: f.adFeeEur >= 0.01 ? f.adFeeEur : null,
      shippingLabelEur: f.shippingLabelEur >= 0.01 ? f.shippingLabelEur : null,
      otherFeeEur: f.otherFeeEur >= 0.01 ? f.otherFeeEur : null,
      refundEur: f.refundEur >= 0.01 ? f.refundEur : null,
      netPayoutEur: f.netPayoutEur,
      feesEstimated: false,
    };
  }
  const family = items?.length ? inventoryFamilyForHub(item, items, lookup) : [item];
  if (familyOwnsFullOrder(normalized, family, items, lookup)) {
    return saleProceedsFromOrder(normalized, mergeHubOrderLines(normalized.lineItems));
  }
  const lines = pickHubLinesForItem(normalized, item, items, lookup);
  const merged = mergeHubOrderLines(lines);
  return saleProceedsFromOrder(normalized, merged);
}

/** @deprecated use pickHubLinesForItem + mergeHubOrderLines */
export function pickHubLineForItem(order: EbayOrderRecord, item: InventoryItem): EbayOrderLineItem {
  return mergeHubOrderLines(pickHubLinesForItem(order, item));
}
