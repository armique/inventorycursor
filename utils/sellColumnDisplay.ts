/**
 * Sell-column buyer total + fee split for inventory rows (desktop + mobile).
 * Keeps Gesamtbetrag (top), Bestelleinnahmen (net), and deduction count in sync after Hub apply.
 */
import type { InventoryItem, TaxMode } from '../types';
import type { EbayOrderRecord } from '../services/ebayOrderIndex';
import { getSoldContainerDisplayTotals, roundMoney } from '../services/financialAggregation';
import { hubSaleColumnSplitForItem } from './hubOrderProceeds';
import {
  isTrustedEbayProceeds,
  saleColumnSplit,
  saleProceedsFromItemFields,
  type SaleColumnSplit,
} from './saleProceeds';

const EPS = 0.02;

function splitCollapsed(split: SaleColumnSplit): boolean {
  if (split.netEur == null) return false;
  return Math.abs(split.totalEur - split.netEur) < EPS;
}

function splitFromStoredProceeds(item: InventoryItem): SaleColumnSplit | null {
  const p = saleProceedsFromItemFields(item);
  const total = p.buyerTotalEur ?? item.sellPrice;
  if (total == null || !Number.isFinite(total)) return null;
  return {
    totalEur: roundMoney(total),
    buyerShippingEur: Math.abs(p.buyerShippingEur ?? 0),
    adFeeEur: Math.abs(p.adFeeEur ?? 0),
    ebayFeeEur: Math.abs(p.transactionFeeEur ?? 0),
    otherFeeEur: Math.abs(p.otherFeeEur ?? 0),
    shippingEur: Math.abs(p.shippingLabelEur ?? 0),
    refundEur: Math.abs(p.refundEur ?? 0),
    netEur: p.netPayoutEur != null ? roundMoney(p.netPayoutEur) : null,
  };
}

/** Buyer-facing total for the sell column (what the buyer paid in total). */
export function resolveSellColumnBuyerTotal(
  item: InventoryItem,
  allItems: InventoryItem[],
  taxMode: TaxMode
): number | null {
  if (isTrustedEbayProceeds(item.saleProceeds) && item.saleProceeds?.buyerTotalEur != null) {
    return roundMoney(item.saleProceeds.buyerTotalEur);
  }

  const soldContainerTotals = getSoldContainerDisplayTotals(item, allItems, taxMode);
  const containerSell = soldContainerTotals?.sellPrice;
  if (containerSell != null && containerSell > EPS) return containerSell;

  const sell = Number(item.sellPrice);
  return sell > EPS ? roundMoney(sell) : null;
}

/** Full sell-cell ledger: total received, net pocket, fee buckets for deduction count. */
export function resolveSellColumnSplit(
  item: InventoryItem,
  allItems: InventoryItem[],
  taxMode: TaxMode,
  extras?: {
    shippingFallbackEur?: number;
    refundFallbackEur?: number;
    hubOrder?: EbayOrderRecord | null;
  }
): SaleColumnSplit | null {
  const buyerTotal = resolveSellColumnBuyerTotal(item, allItems, taxMode);
  if (buyerTotal == null && item.sellPrice == null) return null;

  let split =
    saleColumnSplit(item, {
      displaySellEur: buyerTotal ?? item.sellPrice,
      shippingFallbackEur: extras?.shippingFallbackEur,
      refundFallbackEur: extras?.refundFallbackEur,
    }) ?? null;
  if (!split) return null;

  if (isTrustedEbayProceeds(item.saleProceeds)) {
    const fromStored = splitFromStoredProceeds(item);
    if (fromStored) {
      split = fromStored;
    }
  } else if (splitCollapsed(split)) {
    const feeAmount = roundMoney(Math.abs(Number(item.feeAmount) || 0));
    if (feeAmount >= 0.01) {
      split = { ...split, netEur: roundMoney(Math.max(0, split.totalEur - feeAmount)) };
    }
  }

  const hubOrder = extras?.hubOrder ?? null;
  if (hubOrder && isTrustedEbayProceeds(item.saleProceeds) && splitCollapsed(split)) {
    const hubSplit = hubSaleColumnSplitForItem(hubOrder, item, allItems);
    if (hubSplit.netEur != null && hubSplit.totalEur - hubSplit.netEur >= 0.01) {
      split = {
        ...split,
        totalEur: hubSplit.totalEur,
        buyerShippingEur: hubSplit.buyerShippingEur,
        adFeeEur: hubSplit.adFeeEur,
        ebayFeeEur: hubSplit.ebayFeeEur,
        otherFeeEur: hubSplit.otherFeeEur,
        shippingEur: hubSplit.shippingEur,
        refundEur: hubSplit.refundEur,
        netEur: hubSplit.netEur,
      };
    }
  }

  return split;
}

export function sellColumnSplitHasDistinctNet(split: SaleColumnSplit | null): boolean {
  if (!split || split.netEur == null) return false;
  return Math.abs(split.totalEur - split.netEur) >= EPS;
}
