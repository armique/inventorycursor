import type { DealwatchListing } from '../services/dealwatchApi';

const PICKUP_RE =
  /\bnur\s*(selbst)?abholung\b|\bpick[\s-]?up\s*only\b|\bselbstabholung\b|\bkeine[rn]?\s*versand\b|\bversand\s*(nicht|ausgeschlossen)\b|\bohne\s*versand\b/i;

export function isKleinanzeigenListing(item?: Pick<DealwatchListing, 'marketplace' | 'id' | 'url'> | null): boolean {
  if (!item) return false;
  return (
    item.marketplace === 'kleinanzeigen' ||
    String(item.id || '').startsWith('ka|') ||
    /kleinanzeigen\.de/i.test(item.url || '')
  );
}

export function isPickupOnlyListing(item?: DealwatchListing | null): boolean {
  if (!item) return false;
  if (item.pickupOnly === true) return true;
  if (item.shippingPossible === true) return false;
  if (isKleinanzeigenListing(item)) return true;
  const text = [item.title, item.condition, item.location, item.seller].filter(Boolean).join(' ');
  return PICKUP_RE.test(text);
}

export function rejectReasonLabel(reason?: string | null): string {
  const key = String(reason || '').toLowerCase();
  if (key === 'suche') return 'Suche';
  if (key === 'price') return 'Price';
  if (key === 'feedback') return 'Feedback';
  if (key === 'auction') return 'Auction';
  if (key === 'condition') return 'Condition';
  if (key === 'filter') return 'Filter';
  return 'Rejected';
}
