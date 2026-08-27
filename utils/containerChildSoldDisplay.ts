import type { InventoryItem } from '../types';
import { computeSoldTabMargin, getChildren, getParentContainer, roundMoney } from '../services/financialAggregation';
import { isRealizedDisposal } from './itemDisposition';
import { allocateMoneyByWeight } from './allocateMoneyByWeight';
import { splitEqualEur } from './ebaySaleAdjustments';
import {
  buyerTotalAlreadyNetsRefund,
  netPayoutAfterRefund,
  saleColumnSplit,
  saleProceedsFeeTotal,
} from './saleProceeds';

const EPS = 0.005;

function moneyEq(a: number | null | undefined, b: number | null | undefined): boolean {
  return Math.abs((Number(a) || 0) - (Number(b) || 0)) < EPS;
}

function isSoldContainer(item: InventoryItem | undefined | null): item is InventoryItem {
  return Boolean(item && (item.isPC || item.isBundle) && isRealizedDisposal(item));
}

/** Parent Gesamtbetrag / sell cell — Hub buyerTotal wins until the sell cell overwrites it. */
export function containerBuyerTotalForParts(
  container: InventoryItem,
  children: InventoryItem[]
): number {
  const hub = Number(container.saleProceeds?.buyerTotalEur);
  if (Number.isFinite(hub) && hub > 0.01) return roundMoney(hub);
  const parent = Number(container.sellPrice);
  if (Number.isFinite(parent) && parent > 0.01) return roundMoney(parent);
  return roundMoney(children.reduce((s, c) => s + (Number(c.sellPrice) || 0), 0));
}

/**
 * Bestelleinnahmen to split across parts. Uses the Hub net when the sell total
 * still matches the order; otherwise sell − fees so a manual sell edit is honored.
 */
export function containerNetTotalForParts(
  container: InventoryItem,
  children: InventoryItem[],
  soldTotal = containerBuyerTotalForParts(container, children)
): number {
  const p = container.saleProceeds;
  const storedTotal = Number(p?.buyerTotalEur);
  const storedNet = Number(p?.netPayoutEur);
  if (
    Number.isFinite(storedNet) &&
    Number.isFinite(storedTotal) &&
    storedTotal > 0.01 &&
    Math.abs(soldTotal - storedTotal) < 0.02
  ) {
    return roundMoney(storedNet);
  }
  const feeTotal =
    saleProceedsFeeTotal(p) >= 0.01 ? saleProceedsFeeTotal(p) : Number(container.feeAmount) || 0;
  const refund = Number(p?.refundEur) || 0;
  const alreadyNets = buyerTotalAlreadyNetsRefund(
    p?.itemGrossEur,
    p?.buyerShippingEur,
    refund,
    soldTotal
  );
  const fromFees = netPayoutAfterRefund(soldTotal, feeTotal, null, refund, {
    totalAlreadyNetsRefund: alreadyNets,
  });
  if (fromFees != null && Number.isFinite(fromFees)) return roundMoney(fromFees);
  if (Number.isFinite(storedNet) && Number.isFinite(storedTotal) && storedTotal > 0.01) {
    return roundMoney(storedNet * (soldTotal / storedTotal));
  }
  const split = saleColumnSplit(container, { displaySellEur: soldTotal });
  if (split?.netEur != null && Number.isFinite(split.netEur)) return roundMoney(split.netEur);
  return roundMoney(Math.max(0, soldTotal - feeTotal));
}

export function containerChildSoldDisplayMap(
  container: InventoryItem,
  children: InventoryItem[]
): Map<string, number> {
  return allocateMoneyByWeight(
    children.map((c) => ({ id: c.id, weight: Number(c.buyPrice) || 0 })),
    containerBuyerTotalForParts(container, children)
  );
}

export function containerChildProfitDisplayMap(
  container: InventoryItem,
  children: InventoryItem[]
): Map<string, number> {
  const netById = allocateMoneyByWeight(
    children.map((c) => ({ id: c.id, weight: Number(c.buyPrice) || 0 })),
    containerNetTotalForParts(container, children)
  );
  const out = new Map<string, number>();
  for (const child of children) {
    const net = netById.get(child.id) ?? 0;
    out.set(child.id, roundMoney(net - (Number(child.buyPrice) || 0)));
  }
  return out;
}

/** Write sellPrice + Hub buyer/net so the sell cell and nest stay on the same total. */
export function withUpdatedContainerSellPrice(
  container: InventoryItem,
  newSell: number
): InventoryItem {
  const sold = roundMoney(newSell);
  const p = container.saleProceeds;
  if (!p) {
    return { ...container, sellPrice: sold };
  }
  const feeTotal =
    saleProceedsFeeTotal(p) >= 0.01 ? saleProceedsFeeTotal(p) : Number(container.feeAmount) || 0;
  const refund = Number(p.refundEur) || 0;
  const alreadyNets = buyerTotalAlreadyNetsRefund(p.itemGrossEur, p.buyerShippingEur, refund, sold);
  const net =
    netPayoutAfterRefund(sold, feeTotal, null, refund, { totalAlreadyNetsRefund: alreadyNets }) ??
    roundMoney(Math.max(0, sold - feeTotal));
  return {
    ...container,
    sellPrice: sold,
    feeAmount: feeTotal,
    hasFee: feeTotal >= 0.01,
    saleProceeds: {
      ...p,
      buyerTotalEur: sold,
      netPayoutEur: net,
    },
  };
}

function scaleChildrenBuyPrices(children: InventoryItem[], newTotal: number): InventoryItem[] {
  const buyById = allocateMoneyByWeight(
    children.map((c) => ({ id: c.id, weight: Number(c.buyPrice) || 0 })),
    roundMoney(newTotal)
  );
  return children.map((child) => {
    const buy = buyById.get(child.id);
    if (buy == null || moneyEq(child.buyPrice, buy)) return child;
    return { ...child, buyPrice: buy };
  });
}

export type SyncedSoldContainerFamily = {
  container: InventoryItem;
  children: InventoryItem[];
};

/**
 * EK-weighted sold (Gesamtbetrag) + net (Bestelleinnahmen) on every part.
 * Sum(child.sellPrice) === parent sell; sum(child.profit) === net − Σ EK.
 */
export function syncSoldContainerFamily(
  container: InventoryItem,
  children: InventoryItem[]
): SyncedSoldContainerFamily {
  if (!children.length) return { container, children };
  const soldTotal = containerBuyerTotalForParts(container, children);
  const netTotal = containerNetTotalForParts(container, children, soldTotal);
  const weights = children.map((c) => ({ id: c.id, weight: Number(c.buyPrice) || 0 }));
  const soldById = allocateMoneyByWeight(weights, soldTotal);
  const netById = allocateMoneyByWeight(weights, netTotal);

  const nextChildren = children.map((child) => {
    const sell = soldById.get(child.id) ?? 0;
    const net = netById.get(child.id) ?? 0;
    const fee = roundMoney(sell - net);
    const profit = roundMoney(net - (Number(child.buyPrice) || 0));
    if (
      moneyEq(child.sellPrice, sell) &&
      moneyEq(child.feeAmount, fee) &&
      moneyEq(child.profit, profit) &&
      Boolean(child.hasFee) === fee >= 0.01
    ) {
      return child;
    }
    return {
      ...child,
      sellPrice: sell,
      feeAmount: fee,
      hasFee: fee >= 0.01,
      profit,
    };
  });

  const buySum = roundMoney(nextChildren.reduce((s, c) => s + (Number(c.buyPrice) || 0), 0));
  let nextContainer = container;
  if (!moneyEq(nextContainer.buyPrice, buySum)) {
    nextContainer = { ...nextContainer, buyPrice: buySum };
  }
  if (!moneyEq(nextContainer.sellPrice, soldTotal)) {
    nextContainer = { ...nextContainer, sellPrice: soldTotal };
  }
  if (nextContainer.profit != null && !moneyEq(nextContainer.profit, 0)) {
    nextContainer = { ...nextContainer, profit: 0 };
  }
  return { container: nextContainer, children: nextChildren };
}

/**
 * Equal Gesamtbetrag + Bestelleinnahmen on every part (Sheets-style ÷ N).
 * Sum(child.sellPrice) === parent sell; sum(child.profit) === net − Σ EK.
 */
export function syncSoldContainerFamilyEqual(
  container: InventoryItem,
  children: InventoryItem[]
): SyncedSoldContainerFamily {
  if (!children.length) return { container, children };
  const soldTotal = containerBuyerTotalForParts(container, children);
  const netTotal = containerNetTotalForParts(container, children, soldTotal);
  const soldShares = splitEqualEur(soldTotal, children.length);
  const netShares = splitEqualEur(netTotal, children.length);
  const sellDate = container.sellDate;

  const nextChildren = children.map((child, index) => {
    const sell = soldShares[index] ?? 0;
    const net = netShares[index] ?? 0;
    const fee = roundMoney(sell - net);
    const profit = roundMoney(net - (Number(child.buyPrice) || 0));
    if (
      moneyEq(child.sellPrice, sell) &&
      moneyEq(child.feeAmount, fee) &&
      moneyEq(child.profit, profit) &&
      Boolean(child.hasFee) === fee >= 0.01 &&
      child.sellDate === sellDate
    ) {
      return child;
    }
    return {
      ...child,
      sellPrice: sell,
      originalSellPrice: sell,
      sellDate: sellDate || child.sellDate,
      feeAmount: fee,
      hasFee: fee >= 0.01,
      profit,
    };
  });

  const buySum = roundMoney(nextChildren.reduce((s, c) => s + (Number(c.buyPrice) || 0), 0));
  let nextContainer = container;
  if (!moneyEq(nextContainer.buyPrice, buySum)) {
    nextContainer = { ...nextContainer, buyPrice: buySum };
  }
  if (!moneyEq(nextContainer.sellPrice, soldTotal)) {
    nextContainer = { ...nextContainer, sellPrice: soldTotal };
  }
  if (nextContainer.profit != null && !moneyEq(nextContainer.profit, 0)) {
    nextContainer = { ...nextContainer, profit: 0 };
  }
  return { container: nextContainer, children: nextChildren };
}

export function stampContainerChildrenSoldShare(
  container: InventoryItem,
  children: InventoryItem[]
): InventoryItem[] {
  return syncSoldContainerFamily(container, children).children;
}

/** Persist changed children (and parent buy/sell if the family helper adjusted them). */
export function containerChildSoldSharePatches(
  parents: InventoryItem[],
  allItems: InventoryItem[]
): InventoryItem[] {
  const patches: InventoryItem[] = [];
  const seen = new Set<string>();
  for (const parent of parents) {
    if (!isSoldContainer(parent)) continue;
    const kids = getChildren(parent, allItems);
    const { container, children } = syncSoldContainerFamily(parent, kids);
    if (container !== parent && !seen.has(container.id)) {
      seen.add(container.id);
      patches.push(container);
    }
    for (let i = 0; i < kids.length; i++) {
      if (children[i] === kids[i] || seen.has(children[i].id)) continue;
      seen.add(children[i].id);
      patches.push(children[i]);
    }
  }
  return patches;
}

/**
 * After a sell/buy cell edit on a sold PC/bundle or one of its parts, rewrite
 * that family only. Standalone rows keep a single-item profit sync.
 *
 * Uses the equal split (syncSoldContainerFamilyEqual), matching the convention
 * Abrechnung linking already uses ("Sheets ÷ N" — every part gets the same
 * share). This used to redistribute by weighted buy-price share instead
 * (syncSoldContainerFamily) — two different rules touching the same sold
 * family, each overwriting the other's numbers whenever the other one ran,
 * was exactly what showed up as a bundle part's sell price silently
 * flip-flopping between two values over and over.
 */
export function expandSoldContainerPriceSync(
  edited: InventoryItem,
  field: 'buyPrice' | 'sellPrice',
  allItems: InventoryItem[]
): InventoryItem[] {
  const parent = isSoldContainer(edited) ? edited : getParentContainer(edited, allItems);
  const container = parent && parent.id === edited.id ? edited : parent;
  if (!isSoldContainer(container)) {
    let row = edited;
    if (field === 'sellPrice' && edited.saleProceeds) {
      row = withUpdatedContainerSellPrice(edited, Number(edited.sellPrice) || 0);
    }
    if (isRealizedDisposal(row) && row.sellPrice != null) {
      const profit = computeSoldTabMargin(row);
      if (!moneyEq(row.profit, profit)) row = { ...row, profit };
    }
    return [row];
  }

  let nextContainer = container;
  let nextChildren = getChildren(container, allItems).map((c) =>
    c.id === edited.id ? edited : c
  );
  if (!nextChildren.length) return [edited];

  if (field === 'sellPrice' && edited.id === container.id) {
    nextContainer = withUpdatedContainerSellPrice(container, Number(edited.sellPrice) || 0);
  } else if (field === 'sellPrice' && edited.id !== container.id) {
    const soldSum = roundMoney(nextChildren.reduce((s, c) => s + (Number(c.sellPrice) || 0), 0));
    nextContainer = withUpdatedContainerSellPrice(container, soldSum);
  } else if (field === 'buyPrice' && edited.id === container.id) {
    nextChildren = scaleChildrenBuyPrices(nextChildren, Number(edited.buyPrice) || 0);
    nextContainer = { ...container, buyPrice: roundMoney(Number(edited.buyPrice) || 0) };
  }

  const synced = syncSoldContainerFamilyEqual(nextContainer, nextChildren);
  const out = [synced.container, ...synced.children];
  if (!out.some((i) => i.id === edited.id)) out.push(edited);
  return out;
}
