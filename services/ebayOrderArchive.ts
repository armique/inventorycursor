/**
 * One-shot 2025+ archive: Fulfillment orders (ID, buyer, address, items)
 * then Finances fee breakdown, merged into the existing order cache.
 */

import { backfillEbayOrders, type BackfillProgress, type BackfillResult } from './ebayOrderBackfill';
import {
  backfillEbayFinances,
  type FinancesBackfillProgress,
  type FinancesBackfillResult,
} from './ebayFinancesBackfill';
import { EBAY_ORDER_ARCHIVE_FROM } from './ebayOrderIndex';

export type ArchiveProgress =
  | ({ phase: 'orders' } & BackfillProgress)
  | ({ phase: 'finances' } & FinancesBackfillProgress);

export interface ArchiveFetchResult {
  from: string;
  to: string;
  orders: BackfillResult;
  finances: FinancesBackfillResult | null;
}

export function todayISODate(): string {
  return new Date().toISOString().split('T')[0];
}

export async function fetchEbayOrderArchive(
  options?: {
    fromDate?: string;
    toDate?: string;
    skipFinances?: boolean;
    onProgress?: (p: ArchiveProgress) => void;
    cancelToken?: { cancelled: boolean };
  }
): Promise<ArchiveFetchResult> {
  const from = options?.fromDate || EBAY_ORDER_ARCHIVE_FROM;
  const to = options?.toDate || todayISODate();

  const orders = await backfillEbayOrders(from, to, (p) => options?.onProgress?.({ phase: 'orders', ...p }), options?.cancelToken);

  if (options?.cancelToken?.cancelled || orders.cancelled || orders.error || options?.skipFinances) {
    return { from, to, orders, finances: null };
  }

  const finances = await backfillEbayFinances(
    from,
    to,
    (p) => options?.onProgress?.({ phase: 'finances', ...p }),
    options?.cancelToken
  );

  return { from, to, orders, finances };
}
