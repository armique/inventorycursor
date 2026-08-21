/**
 * Restore sold PC · ASUS A320M · Ryzen 2600 · GTX 1080 · 2×Storage
 * after an accidental restock wiped the sale (session undo did not survive).
 *
 * User EK for the built PC: €152.72. Buyer total: €279.90 on 2025-10-14.
 * Part buys are scaled to that lot total; part sells are buy-weight proportional
 * (not the old equal €31.10 split that made the GTX look like a −€49 loss).
 */
import { InventoryItem, ItemSaleCycle, ItemStatus } from '../types';
import { computeSoldTabMargin, roundMoney } from '../services/financialAggregation';

export const ASUS_A320M_PC_NAME = 'PC · ASUS A320M · Ryzen 2600 · GTX 1080 · 2×Storage';
export const ASUS_A320M_PC_BUY = 152.72;
export const ASUS_A320M_PC_SELL = 279.9;
export const ASUS_A320M_PC_SELL_DATE = '2025-10-14';
/** Legacy equal-split per part (279.9 / 9) — used only to detect broken restores. */
export const ASUS_A320M_PART_SELL = 31.1;
export const ASUS_A320M_RESTORE_TAG = `[Sale restored ${ASUS_A320M_PC_SELL_DATE}]`;

export const ASUS_A320M_PART_IDS = [
  'imp-1770932245749-884', // Ryzen 2600
  'imp-1770932245749-885', // GTX 1080 Gigabyte FE
  'imp-1770932245749-886', // HDD Toshiba
  'imp-1770932245749-887', // ASUS A320M
  'imp-1770932245749-888', // Cooler Master case
  'imp-1770932245749-889', // Be quiet 500w
  'imp-1770932245749-890', // Enermax Liqmax
  'imp-1770932245749-891', // 3 ARGB fans
  'imp-1770932245749-892', // Crucial 250GB SSD
] as const;

/** Original import weights (sum €176.71) — scale these to ASUS_A320M_PC_BUY. */
export const ASUS_A320M_PART_BUY_WEIGHTS: Record<(typeof ASUS_A320M_PART_IDS)[number], number> = {
  'imp-1770932245749-884': 12.5, // Ryzen 2600
  'imp-1770932245749-885': 80, // GTX 1080 Gigabyte FE
  'imp-1770932245749-886': 15.5, // HDD Toshiba
  'imp-1770932245749-887': 12.5, // ASUS A320M
  'imp-1770932245749-888': 15.5, // Cooler Master case
  'imp-1770932245749-889': 10, // Be quiet 500w
  'imp-1770932245749-890': 8.21, // Enermax Liqmax
  'imp-1770932245749-891': 15, // 3 ARGB fans
  'imp-1770932245749-892': 7.5, // Crucial 250GB SSD
};

const PART_ID_SET = new Set<string>(ASUS_A320M_PART_IDS);
const RETURNED_NOTE_RE = /\s*\[Returned [^\]]*\]/gi;

function moneyEq(a: unknown, b: number): boolean {
  return roundMoney(Number(a) || 0) === roundMoney(b);
}

/** Split `totalEuros` across weights so cents sum exactly. */
export function allocateEurosByWeights(totalEuros: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const cents = Math.round(totalEuros * 100);
  const safe = weights.map((w) => Math.max(Number(w) || 0, 0));
  const sumW = safe.reduce((a, b) => a + b, 0);
  if (sumW <= 0 || cents === 0) {
    const base = Math.floor(cents / n);
    const extra = cents - base * n;
    return safe.map((_, i) => (base + (i < extra ? 1 : 0)) / 100);
  }
  const raw = safe.map((w) => (cents * w) / sumW);
  const floors = raw.map((x) => Math.floor(x));
  let diff = cents - floors.reduce((a, b) => a + b, 0);
  const fracs = raw.map((x, i) => ({ i, f: x - floors[i] }));
  fracs.sort((a, b) => b.f - a.f);
  const result = [...floors];
  for (let k = 0; k < diff; k++) result[fracs[k % n].i] += 1;
  return result.map((c) => c / 100);
}

function normalizeTitle(name: string | undefined): string {
  return String(name || '')
    .toUpperCase()
    .replace(/[×X]/g, 'X')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Match even when isPC was cleared or punctuation differs. */
export function isAsusA320mPcTitle(name: string | undefined): boolean {
  const n = normalizeTitle(name);
  const hasBoard = n.includes('A320M') || n.includes('ASUS A320');
  const hasCpu = n.includes('2600') && (n.includes('RYZEN') || n.includes('R5') || n.includes('R 5'));
  const hasGpu = n.includes('1080');
  return hasBoard && hasCpu && hasGpu;
}

function stripReturnedNote(comment2?: string): string {
  return String(comment2 || '')
    .replace(RETURNED_NOTE_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function withRestoreTag(comment2?: string): string {
  const base = stripReturnedNote(comment2);
  if (base.includes(ASUS_A320M_RESTORE_TAG)) return base;
  return base ? `${base} ${ASUS_A320M_RESTORE_TAG}` : ASUS_A320M_RESTORE_TAG;
}

function pickSaleCycle(item: InventoryItem): ItemSaleCycle | undefined {
  const cycles = item.ebaySaleCycles || [];
  if (!cycles.length) return undefined;
  return (
    cycles.find((c) => (c.sellDate || '').slice(0, 10) === ASUS_A320M_PC_SELL_DATE) ||
    cycles.find((c) => moneyEq(c.sellPrice, ASUS_A320M_PART_SELL) || moneyEq(c.sellPrice, ASUS_A320M_PC_SELL)) ||
    cycles[cycles.length - 1]
  );
}

function applyCycleMeta(item: InventoryItem, cycle: ItemSaleCycle | undefined): Partial<InventoryItem> {
  if (!cycle) return {};
  return {
    platformSold: cycle.platformSold || item.platformSold,
    paymentType: cycle.paymentType || item.paymentType,
    ebayOrderId: cycle.ebayOrderId || item.ebayOrderId,
    ebayUsername: cycle.ebayUsername || item.ebayUsername,
    ebayOrderLineKey: cycle.ebayOrderLineKey || item.ebayOrderLineKey,
    ebayListingId: cycle.ebayListingId || item.ebayListingId,
    ebaySku: cycle.ebaySku || item.ebaySku,
    customer: cycle.customer || item.customer,
    saleProceeds: cycle.saleProceeds || item.saleProceeds,
    ebaySaleAdjustments: cycle.ebaySaleAdjustments || item.ebaySaleAdjustments,
    feeAmount: cycle.feeAmount ?? item.feeAmount,
    hasFee: cycle.hasFee ?? item.hasFee,
    sellerPaidShipping: cycle.sellerPaidShipping ?? item.sellerPaidShipping,
    sellerShippingAmount: cycle.sellerShippingAmount ?? item.sellerShippingAmount,
    invoiceNumber: cycle.invoiceNumber || item.invoiceNumber,
    originalSellPrice: cycle.originalSellPrice ?? item.originalSellPrice,
  };
}

function partWeight(part: InventoryItem): number {
  const known = ASUS_A320M_PART_BUY_WEIGHTS[part.id as keyof typeof ASUS_A320M_PART_BUY_WEIGHTS];
  if (known != null && known > 0) return known;
  const buy = Number(part.buyPrice) || 0;
  return buy > 0 ? buy : 1;
}

function withSoldPc(item: InventoryItem, componentIds: string[]): InventoryItem {
  const cycle = pickSaleCycle(item);
  const next: InventoryItem = {
    ...item,
    ...applyCycleMeta(item, cycle),
    name: ASUS_A320M_PC_NAME,
    isPC: true,
    isBundle: false,
    componentIds,
    status: ItemStatus.SOLD,
    buyPrice: ASUS_A320M_PC_BUY,
    sellPrice: ASUS_A320M_PC_SELL,
    sellDate: cycle?.sellDate || item.sellDate || ASUS_A320M_PC_SELL_DATE,
    storeVisible: false,
    parentContainerId: undefined,
    // Pocket profit lives on parts — container shows the lot totals only.
    profit: 0,
    comment2: withRestoreTag(item.comment2),
  };
  return next;
}

function applyProportionalPartSale(
  parts: InventoryItem[],
  parentId: string
): InventoryItem[] {
  const weights = parts.map(partWeight);
  const buys = allocateEurosByWeights(ASUS_A320M_PC_BUY, weights);
  const sells = allocateEurosByWeights(ASUS_A320M_PC_SELL, weights);

  return parts.map((part, idx) => {
    const cycle = pickSaleCycle(part);
    const next: InventoryItem = {
      ...part,
      ...applyCycleMeta(part, cycle),
      status: ItemStatus.SOLD,
      parentContainerId: parentId,
      buyPrice: buys[idx],
      sellDate: cycle?.sellDate || part.sellDate || ASUS_A320M_PC_SELL_DATE,
      sellPrice: sells[idx],
      storeVisible: false,
      comment2: withRestoreTag(part.comment2),
    };
    next.profit = computeSoldTabMargin(next);
    return next;
  });
}

function partsPricingLooksCorrect(pc: InventoryItem, parts: InventoryItem[]): boolean {
  if (parts.length === 0) return true;
  const buySum = roundMoney(parts.reduce((s, p) => s + (Number(p.buyPrice) || 0), 0));
  const sellSum = roundMoney(parts.reduce((s, p) => s + (Number(p.sellPrice) || 0), 0));
  if (!moneyEq(buySum, ASUS_A320M_PC_BUY)) return false;
  if (!moneyEq(sellSum, ASUS_A320M_PC_SELL)) return false;
  // Old restore forced equal €31.10 sells — re-heal those.
  const equalSplitCount = parts.filter((p) => moneyEq(p.sellPrice, ASUS_A320M_PART_SELL)).length;
  if (equalSplitCount >= Math.max(3, parts.length - 1)) return false;
  return parts.every(
    (p) =>
      p.status === ItemStatus.SOLD &&
      p.parentContainerId === pc.id &&
      (p.sellDate || '').slice(0, 10) === ASUS_A320M_PC_SELL_DATE
  );
}

function alreadyRestored(pc: InventoryItem, parts: InventoryItem[]): boolean {
  if (pc.status !== ItemStatus.SOLD) return false;
  if (!moneyEq(pc.buyPrice, ASUS_A320M_PC_BUY)) return false;
  if (!moneyEq(pc.sellPrice, ASUS_A320M_PC_SELL)) return false;
  if ((pc.sellDate || '').slice(0, 10) !== ASUS_A320M_PC_SELL_DATE) return false;
  return partsPricingLooksCorrect(pc, parts);
}

function findPc(items: InventoryItem[]): InventoryItem | undefined {
  // Prefer flagged containers, but also match title alone (isPC is sometimes cleared).
  const titled = items.filter((i) => !i.parentContainerId && isAsusA320mPcTitle(i.name));
  const flagged = titled.find((i) => i.isPC || i.isBundle);
  if (flagged) return flagged;
  if (titled.length) return titled[0];

  return items.find(
    (i) =>
      !i.parentContainerId &&
      (i.isPC || i.isBundle) &&
      (i.componentIds || []).filter((id) => PART_ID_SET.has(id)).length >= 5
  );
}

function findKnownParts(items: InventoryItem[]): InventoryItem[] {
  return ASUS_A320M_PART_IDS.map((id) => items.find((i) => i.id === id)).filter(
    (i): i is InventoryItem => !!i
  );
}

/**
 * If the PC was restocked to Active, put it back on Sold with the known Oct 2025 sale.
 * Also heals equal-split / mismatched part EK from the first restore pass.
 */
export function restoreAsusA320mPcSale(items: InventoryItem[]): { items: InventoryItem[]; changed: boolean } {
  if (!items.length) return { items, changed: false };

  const pc = findPc(items);
  const knownParts = findKnownParts(items);

  // Parts exist but shell was deleted — recreate a sold PC shell.
  if (!pc && knownParts.length >= 5) {
    const componentIds = knownParts.map((p) => p.id);
    const shellId = `pc-asus-a320m-ryzen2600-1080-${ASUS_A320M_PC_SELL_DATE}`;
    const buyDate =
      knownParts
        .map((p) => p.buyDate)
        .filter(Boolean)
        .sort()[0] || ASUS_A320M_PC_SELL_DATE;
    const shell = withSoldPc(
      {
        id: shellId,
        name: ASUS_A320M_PC_NAME,
        buyPrice: ASUS_A320M_PC_BUY,
        buyDate,
        category: 'PC',
        status: ItemStatus.SOLD,
        comment1: '',
        comment2: '',
        isPC: true,
        componentIds,
      },
      componentIds
    );
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const part of applyProportionalPartSale(knownParts, shellId)) {
      byId.set(part.id, part);
    }
    byId.set(shell.id, shell);
    return { items: Array.from(byId.values()), changed: true };
  }

  if (!pc) return { items, changed: false };

  const knownIdList = knownParts.map((p) => p.id);
  const componentIds =
    (pc.componentIds || []).length > 0
      ? Array.from(new Set([...(pc.componentIds || []), ...knownIdList]))
      : knownIdList.length
        ? knownIdList
        : [];

  const parts = items.filter(
    (i) => componentIds.includes(i.id) || i.parentContainerId === pc.id || PART_ID_SET.has(i.id)
  );
  const finalComponentIds = componentIds.length ? componentIds : parts.map((p) => p.id);

  if (alreadyRestored(pc, parts)) return { items, changed: false };

  const byId = new Map(items.map((i) => [i.id, i]));
  const restoredPc = withSoldPc({ ...pc, componentIds: finalComponentIds }, finalComponentIds);
  byId.set(restoredPc.id, restoredPc);

  for (const part of applyProportionalPartSale(parts, restoredPc.id)) {
    byId.set(part.id, part);
  }

  return { items: Array.from(byId.values()), changed: true };
}
