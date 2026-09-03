/**
 * Canonical eBay order / transaction dates — always YYYY-MM-DD (Supabase / API style).
 */

import { parseEbayTxDate } from './ebayTransactionReport';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Normalize any eBay date string to YYYY-MM-DD (or null). */
export function normalizeEbayOrderDate(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s === '--') return null;

  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const day = s.slice(0, 10);
    return ISO_DAY.test(day) ? day : null;
  }

  const parsed = parseEbayTxDate(s);
  if (ISO_DAY.test(parsed.sort.slice(0, 10))) return parsed.sort.slice(0, 10);

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);

  return null;
}

/** UI-safe display — ISO day or em dash. */
export function formatEbayOrderDate(raw: string | null | undefined): string {
  return normalizeEbayOrderDate(raw) || '—';
}

/** Abrechnung row dates — both fields use the same ISO day for storage and display. */
export function ebayTxRowDates(raw: string | null | undefined): { createdAt: string; createdSort: string } {
  const sort = normalizeEbayOrderDate(raw) || '';
  return { createdAt: sort, createdSort: sort };
}
