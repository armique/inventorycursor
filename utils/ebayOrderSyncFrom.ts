/** Inclusive earliest order date for API sync / parsing (ignore anything before this). */
export const EBAY_ORDER_SYNC_FROM = '2026-08-28';

export function clampEbaySyncFromDate(fromDate?: string | null): string {
  const raw = (fromDate || EBAY_ORDER_SYNC_FROM).trim().slice(0, 10);
  return raw < EBAY_ORDER_SYNC_FROM ? EBAY_ORDER_SYNC_FROM : raw;
}

export function isEbayOrderOnOrAfterSyncFrom(creationDate: string | null | undefined): boolean {
  if (!creationDate) return false;
  return creationDate.trim().slice(0, 10) >= EBAY_ORDER_SYNC_FROM;
}

export function filterEbayOrdersFromSyncFrom<T extends { creationDate?: string | null }>(orders: T[]): T[] {
  return orders.filter((o) => isEbayOrderOnOrAfterSyncFrom(o.creationDate));
}

export function ebaySyncToDate(): string {
  return new Date().toISOString().slice(0, 10);
}
