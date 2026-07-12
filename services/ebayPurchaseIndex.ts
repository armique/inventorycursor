/**
 * Cache of eBay **buyer** purchases (Trading API GetOrders OrderRole=Buyer).
 * Used to classify business vs personal and link filament / inventory / expenses.
 */

const STORAGE_KEY = 'ebay_purchase_index_v1';

export type EbayPurchaseDisposition =
  | 'pending'
  | 'expense'
  | 'filament'
  | 'inventory'
  | 'personal'
  | 'skipped';

export interface EbayPurchaseRecord {
  /** Stable dedupe key: orderId-transactionId or orderId-itemId */
  lineKey: string;
  orderId: string;
  transactionId?: string | null;
  itemId?: string | null;
  title: string;
  sellerUsername?: string;
  /** YYYY-MM-DD */
  creationDate: string | null;
  quantity: number;
  unitPrice: number | null;
  totalPaid: number | null;
  sources: ('api' | 'manual')[];
  importedAt: string;
  disposition: EbayPurchaseDisposition;
  /** Linked app records */
  expenseId?: string;
  filamentSpoolId?: string;
  inventoryItemId?: string;
  note?: string;
}

export interface EbayPurchaseIndexMeta {
  updatedAt: string;
  count: number;
  apiBackfill?: {
    lastRunAt: string;
    fromDate: string;
    toDate: string;
    fetched: number;
  };
}

export interface EbayPurchaseIndex {
  purchases: EbayPurchaseRecord[];
  meta: EbayPurchaseIndexMeta;
}

function emptyIndex(): EbayPurchaseIndex {
  return {
    purchases: [],
    meta: { updatedAt: new Date().toISOString(), count: 0 },
  };
}

export function loadEbayPurchaseIndex(): EbayPurchaseIndex {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyIndex();
    const parsed = JSON.parse(raw) as EbayPurchaseIndex;
    if (!Array.isArray(parsed?.purchases)) return emptyIndex();
    return parsed;
  } catch {
    return emptyIndex();
  }
}

function saveIndex(index: EbayPurchaseIndex): void {
  const next: EbayPurchaseIndex = {
    purchases: index.purchases,
    meta: {
      ...index.meta,
      updatedAt: new Date().toISOString(),
      count: index.purchases.length,
    },
  };
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('ebay-purchase-index-updated'));
      }
    }
  } catch {
    /* ignore */
  }
}

export function upsertEbayPurchases(
  incoming: Omit<EbayPurchaseRecord, 'importedAt' | 'disposition' | 'sources'>[],
  source: 'api' | 'manual' = 'api'
): { added: number; merged: number } {
  const index = loadEbayPurchaseIndex();
  const byKey = new Map(index.purchases.map((p) => [p.lineKey, p]));
  let added = 0;
  let merged = 0;

  for (const row of incoming) {
    const existing = byKey.get(row.lineKey);
    if (existing) {
      byKey.set(row.lineKey, {
        ...existing,
        title: row.title || existing.title,
        sellerUsername: row.sellerUsername || existing.sellerUsername,
        creationDate: row.creationDate || existing.creationDate,
        quantity: row.quantity ?? existing.quantity,
        unitPrice: row.unitPrice ?? existing.unitPrice,
        totalPaid: row.totalPaid ?? existing.totalPaid,
        orderId: row.orderId || existing.orderId,
        transactionId: row.transactionId ?? existing.transactionId,
        itemId: row.itemId ?? existing.itemId,
        sources: existing.sources.includes(source) ? existing.sources : [...existing.sources, source],
        importedAt: new Date().toISOString(),
      });
      merged++;
    } else {
      byKey.set(row.lineKey, {
        ...row,
        sources: [source],
        disposition: 'pending',
        importedAt: new Date().toISOString(),
      });
      added++;
    }
  }

  saveIndex({ purchases: Array.from(byKey.values()), meta: index.meta });
  return { added, merged };
}

export function setPurchaseDisposition(
  lineKey: string,
  disposition: EbayPurchaseDisposition,
  links?: Partial<Pick<EbayPurchaseRecord, 'expenseId' | 'filamentSpoolId' | 'inventoryItemId' | 'note'>>
): EbayPurchaseIndex {
  const index = loadEbayPurchaseIndex();
  const purchases = index.purchases.map((p) =>
    p.lineKey === lineKey
      ? {
          ...p,
          disposition,
          ...links,
        }
      : p
  );
  const next = { purchases, meta: index.meta };
  saveIndex(next);
  return next;
}

export function setPurchaseBackfillMeta(fromDate: string, toDate: string, fetched: number): void {
  const index = loadEbayPurchaseIndex();
  saveIndex({
    ...index,
    meta: {
      ...index.meta,
      apiBackfill: {
        lastRunAt: new Date().toISOString(),
        fromDate,
        toDate,
        fetched,
      },
    },
  });
}

export function findSpoolByEbayLineKey(lineKey: string): string | undefined {
  const stockRaw = localStorage.getItem('filament_stock_v1');
  if (!stockRaw) return undefined;
  try {
    const stock = JSON.parse(stockRaw) as { spools?: { id: string; ebayLineKey?: string }[] };
    return stock.spools?.find((s) => s.ebayLineKey === lineKey)?.id;
  } catch {
    return undefined;
  }
}
