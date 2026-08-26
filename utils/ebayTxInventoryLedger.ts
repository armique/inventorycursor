import type { InventoryItem, ItemSaleCycle, ItemSaleCycleReason, SaleProceedsBreakdown } from '../types';
import { roundMoney } from '../services/financialAggregation';
import { shouldSkipForAggregatedSaleLine } from '../services/financialAggregation';
import { isSoldOrTradedOnly } from './itemDisposition';
import { hasEbaySaleSignals, resolveSalePlatform } from './salePlatform';
import { formatEbayTxDay, parseEbayTxDate, type EbayTxKind, type EbayTxRow } from './ebayTransactionReport';

type EbaySaleSnapshot = {
  sourceKey: string;
  orderId: string;
  lineKey: string;
  title: string;
  sellDate: string;
  buyerUsername?: string;
  buyerName?: string;
  city?: string;
  zip?: string;
  country?: string;
  listingId?: string;
  sku?: string;
  saleProceeds?: SaleProceedsBreakdown;
  sellPrice?: number;
  feeAmount?: number;
  closedAt?: string;
  refundKind?: 'full' | 'partial';
  refundEur?: number;
  leftoverLossEur?: number;
  cycleReason?: ItemSaleCycleReason;
  isClosed: boolean;
};

function cycleIsEbay(cycle: ItemSaleCycle): boolean {
  if (cycle.ebayOrderId?.trim()) return true;
  if (cycle.platformSold === 'ebay.de' || cycle.paymentType === 'ebay.de') return true;
  return false;
}

function itemIsEbaySale(item: InventoryItem): boolean {
  return resolveSalePlatform(item) === 'ebay.de' || hasEbaySaleSignals(item);
}

function dateParts(raw?: string | null): { createdAt: string; createdSort: string } {
  const parsed = parseEbayTxDate(raw || '');
  const createdSort = /^\d{4}-\d{2}-\d{2}/.test(parsed.sort)
    ? parsed.sort.slice(0, 10)
    : (raw || '').slice(0, 10);
  const createdAt = parsed.display || formatEbayTxDay(createdSort) || raw || '';
  return { createdAt, createdSort };
}

function snapshotFromActiveItem(item: InventoryItem): EbaySaleSnapshot | null {
  if (!isSoldOrTradedOnly(item) || !itemIsEbaySale(item)) return null;
  const orderId = (item.ebayOrderId || '').trim();
  if (!orderId && !item.sellDate && item.sellPrice == null && !item.saleProceeds) return null;
  const sellDate = (item.sellDate || '').slice(0, 10);
  return {
    sourceKey: item.id,
    orderId: orderId || `inventory-${item.id}`,
    lineKey: item.ebayOrderLineKey || `${orderId || item.id}::${item.ebaySku || item.name}`,
    title: item.name,
    sellDate,
    buyerUsername: item.ebayUsername,
    buyerName: item.customer?.name,
    listingId: item.ebayListingId,
    sku: item.ebaySku,
    saleProceeds: item.saleProceeds,
    sellPrice: item.sellPrice,
    feeAmount: item.feeAmount,
    isClosed: false,
  };
}

function snapshotFromCycle(item: InventoryItem, cycle: ItemSaleCycle): EbaySaleSnapshot | null {
  if (!cycleIsEbay(cycle)) return null;
  const orderId = (cycle.ebayOrderId || '').trim();
  if (!orderId && !cycle.sellDate && cycle.sellPrice == null && !cycle.saleProceeds) return null;
  return {
    sourceKey: cycle.id || `${item.id}-${orderId || cycle.closedAt}`,
    orderId: orderId || `inventory-${item.id}-${cycle.id}`,
    lineKey: cycle.ebayOrderLineKey || `${orderId || cycle.id}::${cycle.ebaySku || item.name}`,
    title: item.name,
    sellDate: (cycle.sellDate || cycle.closedAt || '').slice(0, 10),
    buyerUsername: cycle.ebayUsername,
    buyerName: cycle.customer?.name,
    listingId: cycle.ebayListingId,
    sku: cycle.ebaySku,
    saleProceeds: cycle.saleProceeds,
    sellPrice: cycle.sellPrice,
    feeAmount: cycle.feeAmount,
    closedAt: cycle.closedAt,
    refundKind: cycle.refundKind,
    refundEur: cycle.refundEur,
    leftoverLossEur: cycle.leftoverLossEur,
    cycleReason: cycle.reason,
    isClosed: true,
  };
}

export function collectEbayInventorySaleSnapshots(items: InventoryItem[]): EbaySaleSnapshot[] {
  const out: EbaySaleSnapshot[] = [];
  const seenActive = new Set<string>();

  for (const item of items) {
    if (shouldSkipForAggregatedSaleLine(item, items)) continue;

    const active = snapshotFromActiveItem(item);
    if (active) {
      const key = active.lineKey.toLowerCase();
      if (!seenActive.has(key)) {
        seenActive.add(key);
        out.push(active);
      }
    }

    for (const cycle of item.ebaySaleCycles || []) {
      const snap = snapshotFromCycle(item, cycle);
      if (snap) out.push(snap);
    }
  }

  return out;
}

function buyerTotalFromSnapshot(snapshot: EbaySaleSnapshot): number {
  const sp = snapshot.saleProceeds;
  if (sp?.buyerTotalEur != null && Number.isFinite(sp.buyerTotalEur)) return roundMoney(sp.buyerTotalEur);
  const itemGross = sp?.itemGrossEur ?? snapshot.sellPrice ?? 0;
  const ship = sp?.buyerShippingEur ?? 0;
  return roundMoney(itemGross + ship);
}

function needsRefundRow(snapshot: EbaySaleSnapshot): boolean {
  if (!snapshot.isClosed) return false;
  if (snapshot.refundKind === 'full' || snapshot.refundKind === 'partial') return true;
  if (snapshot.cycleReason === 'erstattet' || snapshot.cycleReason === 'return' || snapshot.cycleReason === 'cancelled') {
    return true;
  }
  if (snapshot.leftoverLossEur != null && snapshot.leftoverLossEur >= 0.01) return true;
  if (snapshot.refundEur != null && snapshot.refundEur >= 0.01) return true;
  return false;
}

function refundNetEur(snapshot: EbaySaleSnapshot, buyerTotal: number): number {
  if (snapshot.refundEur != null && snapshot.refundEur >= 0.01) {
    return -roundMoney(snapshot.refundEur);
  }
  if (snapshot.refundKind === 'full' || snapshot.cycleReason === 'erstattet') {
    return -buyerTotal;
  }
  if (snapshot.refundKind === 'partial' && snapshot.saleProceeds?.refundEur != null) {
    return -roundMoney(Math.abs(snapshot.saleProceeds.refundEur));
  }
  if (snapshot.leftoverLossEur != null && snapshot.leftoverLossEur >= 0.01) {
    return -roundMoney(snapshot.leftoverLossEur);
  }
  if (snapshot.cycleReason === 'return' || snapshot.cycleReason === 'cancelled') {
    return -buyerTotal;
  }
  return 0;
}

function refundDescription(snapshot: EbaySaleSnapshot): string {
  if (snapshot.cycleReason === 'erstattet') return 'Inventory · Erstattet';
  if (snapshot.cycleReason === 'return') return 'Inventory · buyer return';
  if (snapshot.cycleReason === 'cancelled') return 'Inventory · cancelled';
  if (snapshot.cycleReason === 'manual_unsold') return 'Inventory · unsold / fee loss';
  return 'Inventory · refund / restock';
}

function rowsFromSnapshot(snapshot: EbaySaleSnapshot): EbayTxRow[] {
  const rows: EbayTxRow[] = [];
  const sp = snapshot.saleProceeds;
  const itemGross = roundMoney(sp?.itemGrossEur ?? snapshot.sellPrice ?? 0);
  const buyerShip = roundMoney(sp?.buyerShippingEur ?? 0);
  const buyerTotal = buyerTotalFromSnapshot(snapshot);
  const fvf = roundMoney(Math.abs(sp?.transactionFeeEur ?? snapshot.feeAmount ?? 0));
  const ads = roundMoney(Math.abs(sp?.adFeeEur ?? 0));
  const label = roundMoney(Math.abs(sp?.shippingLabelEur ?? 0));
  const orderNet = roundMoney(buyerTotal - fvf);
  const saleDate = dateParts(snapshot.sellDate);
  const idPrefix = `inv-${snapshot.sourceKey.replace(/[^a-zA-Z0-9_-]+/g, '_')}`;

  rows.push({
    id: `${idPrefix}-order`,
    createdAt: saleDate.createdAt,
    createdSort: saleDate.createdSort,
    typeRaw: 'Bestellung',
    kind: 'order',
    orderId: snapshot.orderId,
    buyerUsername: snapshot.buyerUsername || '',
    buyerName: snapshot.buyerName || '',
    city: snapshot.city || '',
    zip: snapshot.zip || '',
    country: snapshot.country || '',
    netEur: orderNet,
    payoutDate: '',
    payoutId: '',
    payoutMethod: '',
    payoutStatus: '',
    listingId: snapshot.listingId || '',
    transactionId: '',
    title: snapshot.title,
    sku: snapshot.sku || '',
    quantity: 1,
    itemSubtotalEur: itemGross || null,
    shippingEur: buyerShip || null,
    sellerTaxEur: null,
    ebayTaxEur: null,
    fixedFeeEur: null,
    variableFeeEur: fvf > 0 ? -fvf : null,
    otherOrderFeeEur: null,
    grossEur: buyerTotal || null,
    currency: 'EUR',
    reference: snapshot.lineKey,
    description: snapshot.isClosed ? 'Inventory · closed sale' : 'Inventory · live sale',
    source: 'inventory',
  });

  if (label >= 0.01) {
    rows.push({
      id: `${idPrefix}-label`,
      createdAt: saleDate.createdAt,
      createdSort: saleDate.createdSort,
      typeRaw: 'Versandetikett',
      kind: 'label',
      orderId: snapshot.orderId,
      buyerUsername: '',
      buyerName: '',
      city: '',
      zip: '',
      country: '',
      netEur: -label,
      payoutDate: '',
      payoutId: '',
      payoutMethod: '',
      payoutStatus: '',
      listingId: snapshot.listingId || '',
      transactionId: '',
      title: snapshot.title,
      sku: snapshot.sku || '',
      quantity: null,
      itemSubtotalEur: null,
      shippingEur: null,
      sellerTaxEur: null,
      ebayTaxEur: null,
      fixedFeeEur: null,
      variableFeeEur: null,
      otherOrderFeeEur: null,
      grossEur: -label,
      currency: 'EUR',
      reference: snapshot.lineKey,
      description: 'Inventory · Versandetikett',
      source: 'inventory',
    });
  }

  if (ads >= 0.01) {
    rows.push({
      id: `${idPrefix}-ads`,
      createdAt: saleDate.createdAt,
      createdSort: saleDate.createdSort,
      typeRaw: 'Gebühr für Basis-Anzeigen',
      kind: 'other_fee',
      orderId: snapshot.orderId,
      buyerUsername: '',
      buyerName: '',
      city: '',
      zip: '',
      country: '',
      netEur: -ads,
      payoutDate: '',
      payoutId: '',
      payoutMethod: '',
      payoutStatus: '',
      listingId: snapshot.listingId || '',
      transactionId: '',
      title: snapshot.title,
      sku: snapshot.sku || '',
      quantity: null,
      itemSubtotalEur: null,
      shippingEur: null,
      sellerTaxEur: null,
      ebayTaxEur: null,
      fixedFeeEur: null,
      variableFeeEur: null,
      otherOrderFeeEur: null,
      grossEur: -ads,
      currency: 'EUR',
      reference: snapshot.lineKey,
      description: 'Inventory · Basis-Anzeigen',
      source: 'inventory',
    });
  }

  if (needsRefundRow(snapshot)) {
    const refundDate = dateParts(snapshot.closedAt?.slice(0, 10) || snapshot.sellDate);
    const refundNet = refundNetEur(snapshot, buyerTotal);
    if (Math.abs(refundNet) >= 0.005) {
      rows.push({
        id: `${idPrefix}-refund`,
        createdAt: refundDate.createdAt,
        createdSort: refundDate.createdSort || saleDate.createdSort,
        typeRaw: 'Rückerstattung',
        kind: 'refund',
        orderId: snapshot.orderId,
        buyerUsername: snapshot.buyerUsername || '',
        buyerName: snapshot.buyerName || '',
        city: '',
        zip: '',
        country: '',
        netEur: refundNet,
        payoutDate: '',
        payoutId: '',
        payoutMethod: '',
        payoutStatus: '',
        listingId: snapshot.listingId || '',
        transactionId: '',
        title: snapshot.title,
        sku: snapshot.sku || '',
        quantity: null,
        itemSubtotalEur: null,
        shippingEur: null,
        sellerTaxEur: null,
        ebayTaxEur: null,
        fixedFeeEur: null,
        variableFeeEur: null,
        otherOrderFeeEur: null,
        grossEur: refundNet,
        currency: 'EUR',
        reference: snapshot.lineKey,
        description: refundDescription(snapshot),
        source: 'inventory',
      });
    }
  }

  return rows;
}

export function buildEbayTxRowsFromInventory(items: InventoryItem[]): EbayTxRow[] {
  const rows: EbayTxRow[] = [];
  for (const snapshot of collectEbayInventorySaleSnapshots(items)) {
    rows.push(...rowsFromSnapshot(snapshot));
  }
  rows.sort((a, b) => (b.createdSort || '').localeCompare(a.createdSort || '') || a.id.localeCompare(b.id));
  return rows;
}

function csvOrderIds(rows: EbayTxRow[]): Set<string> {
  const set = new Set<string>();
  for (const row of rows) {
    if (row.kind === 'order' && row.orderId) set.add(row.orderId.toLowerCase());
  }
  return set;
}

function csvRefundOrderIds(rows: EbayTxRow[]): Set<string> {
  const set = new Set<string>();
  for (const row of rows) {
    if (!row.orderId) continue;
    if (row.kind === 'refund' || row.kind === 'case' || row.kind === 'dispute') {
      set.add(row.orderId.toLowerCase());
    }
  }
  return set;
}

/** CSV rows win for the same order; inventory fills gaps and shows restocks before CSV import. */
export function mergeEbayTxRowsWithInventory(csvRows: EbayTxRow[], items: InventoryItem[]): EbayTxRow[] {
  const inventoryRows = buildEbayTxRowsFromInventory(items);
  if (!inventoryRows.length) return csvRows;
  if (!csvRows.length) return inventoryRows;

  const csvOrders = csvOrderIds(csvRows);
  const csvRefunds = csvRefundOrderIds(csvRows);
  const merged = [...csvRows];
  const seenIds = new Set(csvRows.map((row) => row.id));

  for (const row of inventoryRows) {
    if (seenIds.has(row.id)) continue;
    const oid = (row.orderId || '').toLowerCase();
    if (row.kind === 'order' && oid && csvOrders.has(oid)) continue;
    if ((row.kind === 'refund' || row.kind === 'case' || row.kind === 'dispute') && oid && csvRefunds.has(oid)) {
      continue;
    }
    seenIds.add(row.id);
    merged.push(row);
  }

  merged.sort((a, b) => (b.createdSort || '').localeCompare(a.createdSort || '') || a.id.localeCompare(b.id));
  return merged;
}

export function countEbayTxInventoryRows(items: InventoryItem[]): number {
  return buildEbayTxRowsFromInventory(items).length;
}

export function inventoryKindLabel(kind: EbayTxKind): string | null {
  return kind === 'order' ? 'Inventory sale' : null;
}
