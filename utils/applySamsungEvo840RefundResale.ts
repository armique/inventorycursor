/**
 * Samsung EVO 840 500GB: eBay sale → full refund (−€6.73 net loss on fees) → cash resale.
 *
 * Archives Franz Haselbeck / hafra09 order #22-14949-82264 into ebaySaleCycles,
 * capitalizes €6.73 into EK, then marks sold to Natasha Olesja Schon for €50 cash.
 */
import { InventoryItem, ItemStatus, TaxMode } from '../types';
import { computeSoldTabMargin, roundMoney } from '../services/financialAggregation';
import { appendBuyPriceChange, appendPriceHistoryIfChanged } from '../services/priceHistory';
import { appendReturnedNote, restockItemFields } from '../services/saleRevert';
import { itemHasActiveSaleSnapshot } from '../utils/itemSaleCycle';

export const SAMSUNG_EVO840_ORDER_ID = '22-14949-82264';
export const SAMSUNG_EVO840_EBAY_USER = 'hafra09';
export const SAMSUNG_EVO840_EBAY_BUYER = 'Franz Haselbeck';
export const SAMSUNG_EVO840_REFUND_LOSS = 6.73;
export const SAMSUNG_EVO840_CASH_BUYER = 'Natasha Olesja Schon';
export const SAMSUNG_EVO840_CASH_SELL = 50;
/** Local cash sale after the eBay return. */
export const SAMSUNG_EVO840_CASH_SELL_DATE = '2026-08-22';
export const SAMSUNG_EVO840_PATCH_TAG = `[Cash resale ${SAMSUNG_EVO840_CASH_SELL_DATE}]`;

function normalizeName(name: string | undefined): string {
  return String(name || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

export function isSamsungEvo840Ssd(name: string | undefined): boolean {
  const n = normalizeName(name);
  return n.includes('840') && n.includes('500') && (n.includes('EVO') || n.includes('SAMSUNG'));
}

export function matchesSamsungEvo840RefundTarget(item: InventoryItem): boolean {
  const order = String(item.ebayOrderId || '').includes(SAMSUNG_EVO840_ORDER_ID);
  if (order) return true;
  if (!isSamsungEvo840Ssd(item.name)) return false;
  const buyer = String(item.customer?.name || '');
  const user = String(item.ebayUsername || '').toLowerCase();
  if (buyer.includes('Franz') || user === SAMSUNG_EVO840_EBAY_USER.toLowerCase()) return true;
  const cycles = item.ebaySaleCycles || [];
  if (
    cycles.some((c) => String(c.ebayOrderId || '').includes(SAMSUNG_EVO840_ORDER_ID)) &&
    buyer.includes('Natasha')
  ) {
    return true;
  }
  return false;
}

function hasArchivedEbayCycle(item: InventoryItem): boolean {
  return (item.ebaySaleCycles || []).some((c) =>
    String(c.ebayOrderId || '').includes(SAMSUNG_EVO840_ORDER_ID)
  );
}

function isLiveEbaySale(item: InventoryItem): boolean {
  return (
    item.status === ItemStatus.SOLD &&
    (String(item.ebayOrderId || '').includes(SAMSUNG_EVO840_ORDER_ID) ||
      String(item.ebayUsername || '').toLowerCase() === SAMSUNG_EVO840_EBAY_USER.toLowerCase() ||
      String(item.customer?.name || '').includes('Franz'))
  );
}

function targetBuyAfterRefund(item: InventoryItem): number {
  const base = roundMoney(Number(item.buyPrice) || 0);
  if (base >= roundMoney(25.63 + SAMSUNG_EVO840_REFUND_LOSS) - 0.01) return base;
  return roundMoney(25.63 + SAMSUNG_EVO840_REFUND_LOSS);
}

function appendHubErstattetNote(comment2: string | undefined): string {
  const tag = `[Hub Erstattet +€${SAMSUNG_EVO840_REFUND_LOSS.toFixed(2)} EK ${SAMSUNG_EVO840_ORDER_ID}]`;
  const current = comment2 || '';
  if (current.includes(tag) || current.includes('Hub Erstattet +€6.73')) return current;
  return current.trim() ? `${current.trim()} ${tag}` : tag;
}

function alreadyApplied(item: InventoryItem): boolean {
  if (!matchesSamsungEvo840RefundTarget(item)) return false;
  if (item.status !== ItemStatus.SOLD) return false;
  if (!String(item.customer?.name || '').includes('Natasha')) return false;
  if (!hasArchivedEbayCycle(item)) return false;
  if (roundMoney(Number(item.sellPrice) || 0) !== SAMSUNG_EVO840_CASH_SELL) return false;
  if (roundMoney(Number(item.buyPrice) || 0) < targetBuyAfterRefund(item) - 0.01) return false;
  if ((item.sellDate || '').slice(0, 10) !== SAMSUNG_EVO840_CASH_SELL_DATE) return false;
  return true;
}

function archiveEbayRefund(item: InventoryItem): InventoryItem {
  const buyBefore = roundMoney(Number(item.buyPrice) || 25.63);
  const buyAfter = targetBuyAfterRefund(item);

  let restocked = restockItemFields(item, {
    status: ItemStatus.IN_STOCK,
    comment2: appendReturnedNote(item.comment2),
    cycleReason: 'erstattet',
    leftoverLossEur: SAMSUNG_EVO840_REFUND_LOSS,
    refundKind: 'full',
    refundEur: Number(item.sellPrice) || undefined,
  });

  if (buyAfter > buyBefore + 0.004) {
    restocked = appendBuyPriceChange(
      { ...restocked, comment2: appendHubErstattetNote(restocked.comment2) },
      {
        buyBefore,
        buyAfter,
        reason: 'hub_erstattet',
        reasonLabel: `Erstattet — fees/shipping +€${SAMSUNG_EVO840_REFUND_LOSS.toFixed(2)} EK · #${SAMSUNG_EVO840_ORDER_ID}`,
        orderId: SAMSUNG_EVO840_ORDER_ID,
      }
    );
  }

  return restocked;
}

function ensureRefundCapitalized(item: InventoryItem): InventoryItem {
  const buyTarget = targetBuyAfterRefund(item);
  const buyNow = roundMoney(Number(item.buyPrice) || 0);

  if (hasArchivedEbayCycle(item) && buyNow >= buyTarget - 0.004) {
    return {
      ...item,
      comment2: appendHubErstattetNote(appendReturnedNote(item.comment2)),
    };
  }

  if (isLiveEbaySale(item) || itemHasActiveSaleSnapshot(item)) {
    return archiveEbayRefund(item);
  }

  // Manually restocked without cycle — rebuild archive from known eBay sale constants.
  return archiveEbayRefund({
    ...item,
    status: ItemStatus.IN_STOCK,
    sellPrice: 59.99,
    sellDate: item.sellDate || '2026-08-18',
    ebayOrderId: SAMSUNG_EVO840_ORDER_ID,
    ebayUsername: SAMSUNG_EVO840_EBAY_USER,
    customer: { name: SAMSUNG_EVO840_EBAY_BUYER, address: item.customer?.address || '' },
    platformSold: 'ebay.de',
    paymentType: 'ebay.de',
  });
}

function applyCashResale(item: InventoryItem, _taxMode: TaxMode): InventoryItem {
  const base = {
    ...item,
    status: ItemStatus.SOLD,
    sellPrice: SAMSUNG_EVO840_CASH_SELL,
    sellDate: SAMSUNG_EVO840_CASH_SELL_DATE,
    platformSold: 'In Person',
    paymentType: 'Cash',
    customer: { name: SAMSUNG_EVO840_CASH_BUYER, address: '' },
    feeAmount: 0,
    hasFee: false,
    sellerPaidShipping: false,
    sellerShippingAmount: undefined,
    saleProceeds: undefined,
    ebayOrderId: undefined,
    ebayOrderLineKey: undefined,
    ebayUsername: undefined,
    ebayListingId: item.ebayListingId,
    ebaySku: item.ebaySku,
    originalSellPrice: undefined,
    ebaySaleAdjustments: undefined,
    externalOrderId: undefined,
    sourceOrderUrl: undefined,
    ebayOrderScreenshotUrl: undefined,
    comment2: `${String(item.comment2 || '').trim()} ${SAMSUNG_EVO840_PATCH_TAG}`.trim(),
  };
  const withHistory = appendPriceHistoryIfChanged(item, base);
  return { ...withHistory, profit: computeSoldTabMargin(withHistory) };
}

/**
 * Idempotent boot patch: refund eBay sale (+€6.73 EK) then cash resale to Natasha.
 */
export function applySamsungEvo840RefundResale(
  items: InventoryItem[],
  _taxMode: TaxMode = 'SmallBusiness'
): { items: InventoryItem[]; changed: boolean } {
  if (!items.length) return { items, changed: false };

  const idx = items.findIndex(matchesSamsungEvo840RefundTarget);
  if (idx < 0) return { items, changed: false };

  const current = items[idx];
  if (alreadyApplied(current)) return { items, changed: false };

  let working = current;
  if (isLiveEbaySale(working) || !hasArchivedEbayCycle(working)) {
    working = ensureRefundCapitalized(working);
  } else if (roundMoney(Number(working.buyPrice) || 0) < targetBuyAfterRefund(working) - 0.004) {
    working = ensureRefundCapitalized(working);
  }

  const sold = applyCashResale(working, _taxMode);
  const nextItems = items.map((row) => (row.id === sold.id ? sold : row));
  return { items: nextItems, changed: true };
}
