/**
 * Historical eBay sale stored Bestelleinnahmen (€107.73) as sellPrice.
 * Invoice must show what the buyer paid; fees stay on the cost side.
 *
 * Vom Käufer bezahlt: 132.74 + Versand 6.19 = 138.93
 * Verkaufskosten: Transaktion 11.29 + Anzeigengebühr 13.72 + Etikett 6.19
 * Bestelleinnahmen: 107.73
 */
import { ItemStatus, type InventoryItem, type TaxMode } from '../types';
import { computeItemProfitBeforeOverhead, roundMoney } from '../services/financialAggregation';
import { loadEbayOrderIndex } from '../services/ebayOrderIndex';
import { getOrderEffectiveNet } from './ebayOrderFinancial';

export const CRUCIAL_RAM_SKU = 'CT16G48C40S5';
export const CRUCIAL_RAM_OLD_NET = 107.73;
export const CRUCIAL_RAM_BUYER_ITEM = 132.74;
export const CRUCIAL_RAM_BUYER_SHIPPING = 6.19;
export const CRUCIAL_RAM_BUYER_TOTAL = 138.93;
export const CRUCIAL_RAM_TX_FEE = 11.29;
export const CRUCIAL_RAM_AD_FEE = 13.72;
export const CRUCIAL_RAM_FEES = roundMoney(CRUCIAL_RAM_TX_FEE + CRUCIAL_RAM_AD_FEE);
export const CRUCIAL_RAM_EBAY_TITLE = 'CRUCIAL 16GB DDR5 4800MHZ RAM CT16G48C40S5';

function moneyEq(value: unknown, expected: number): boolean {
  return roundMoney(Number(value)) === expected;
}

function blobOf(item: InventoryItem): string {
  return [
    item.name,
    item.ebaySku,
    item.comment1,
    item.comment2,
    item.ebayOrderId,
  ]
    .map((v) => String(v || '').toUpperCase())
    .join(' ');
}

export function isCrucialRamListingText(text: string | undefined): boolean {
  const blob = String(text || '').toUpperCase();
  if (!blob.trim()) return false;
  if (blob.includes('CT2K')) return false;
  if (blob.includes(CRUCIAL_RAM_SKU)) return true;
  if (blob.includes(CRUCIAL_RAM_EBAY_TITLE)) return true;
  const crucial = blob.includes('CRUCIAL');
  const ddr5 = blob.includes('DDR5');
  const speed = blob.includes('4800');
  const size = /16\s*GB/.test(blob) || blob.includes('16GB');
  return crucial && ddr5 && speed && size;
}

function ramOrderIdsFromCache(): Set<string> {
  const ids = new Set<string>();
  try {
    const { orders } = loadEbayOrderIndex();
    for (const order of orders) {
      const title = order.lineItems.map((line) => line.title).join(' ');
      const net = getOrderEffectiveNet(order);
      if (!isCrucialRamListingText(title)) continue;
      if (moneyEq(net, CRUCIAL_RAM_OLD_NET) || moneyEq(order.grossTotal, CRUCIAL_RAM_BUYER_TOTAL)) {
        ids.add(order.orderId);
      }
    }
  } catch {
    /* node tests / missing localStorage */
  }
  return ids;
}

function alreadyPatched(item: InventoryItem): boolean {
  return (
    moneyEq(item.sellPrice, CRUCIAL_RAM_BUYER_TOTAL) &&
    moneyEq(item.feeAmount, CRUCIAL_RAM_FEES) &&
    item.hasFee === true &&
    item.sellerPaidShipping === true &&
    moneyEq(item.sellerShippingAmount, CRUCIAL_RAM_BUYER_SHIPPING) &&
    moneyEq(item.saleProceeds?.netPayoutEur, CRUCIAL_RAM_OLD_NET)
  );
}

export function isCrucialRamLegacyNetSale(item: InventoryItem, ramOrderIds?: Set<string>): boolean {
  if (item.status !== ItemStatus.SOLD && item.status !== ItemStatus.IN_COMPOSITION) return false;
  if (alreadyPatched(item)) return false;
  const blob = blobOf(item);
  if (blob.includes('CT2K')) return false;
  const looksLikeRam = isCrucialRamListingText(blob) || (ramOrderIds?.has(item.ebayOrderId || '') ?? false);
  if (!looksLikeRam && item.platformSold !== 'ebay.de') return false;
  if (!looksLikeRam && !moneyEq(item.sellPrice, CRUCIAL_RAM_OLD_NET)) return false;
  if (!looksLikeRam) return false;
  const sell = roundMoney(item.sellPrice);
  return (
    moneyEq(sell, CRUCIAL_RAM_OLD_NET) ||
    moneyEq(sell, CRUCIAL_RAM_BUYER_ITEM) ||
    moneyEq(sell, CRUCIAL_RAM_BUYER_TOTAL)
  );
}

export function patchCrucialRamInvoiceSale(
  item: InventoryItem,
  taxMode: TaxMode
): InventoryItem {
  const next: InventoryItem = {
    ...item,
    originalSellPrice: item.originalSellPrice ?? item.sellPrice,
    sellPrice: CRUCIAL_RAM_BUYER_TOTAL,
    hasFee: true,
    feeAmount: CRUCIAL_RAM_FEES,
    sellerPaidShipping: true,
    sellerShippingAmount: CRUCIAL_RAM_BUYER_SHIPPING,
    saleProceeds: {
      capturedAt: new Date().toISOString(),
      source: 'ebay_order',
      itemGrossEur: CRUCIAL_RAM_BUYER_ITEM,
      buyerShippingEur: CRUCIAL_RAM_BUYER_SHIPPING,
      buyerTotalEur: CRUCIAL_RAM_BUYER_TOTAL,
      transactionFeeEur: CRUCIAL_RAM_TX_FEE,
      adFeeEur: CRUCIAL_RAM_AD_FEE,
      shippingLabelEur: CRUCIAL_RAM_BUYER_SHIPPING,
      otherFeeEur: null,
      netPayoutEur: CRUCIAL_RAM_OLD_NET,
    },
  };
  if (item.status === ItemStatus.IN_COMPOSITION) {
    return next;
  }
  const profit = computeItemProfitBeforeOverhead(next, taxMode);
  return { ...next, profit };
}

export function applyCrucialRamInvoiceSaleFix(
  items: InventoryItem[],
  taxMode: TaxMode
): { items: InventoryItem[]; changed: boolean } {
  const ramOrderIds = ramOrderIdsFromCache();
  let changed = false;
  const next = items.map((item) => {
    if (!isCrucialRamLegacyNetSale(item, ramOrderIds)) return item;
    changed = true;
    return patchCrucialRamInvoiceSale(item, taxMode);
  });
  return { items: changed ? next : items, changed };
}
