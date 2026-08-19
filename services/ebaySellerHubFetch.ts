import type { EbaySellerHubPayout } from '../lib/ebaySellerHubPayout';
import { EBAY_SELLER_HUB_ORDERS_URL } from '../lib/ebaySellerHubPayout';

export type SellerHubFetchCandidate = {
  orderId: string;
  snippet?: string;
  href?: string;
  score?: number;
};

export type SellerHubFetchResult =
  | {
      ok: true;
      source: 'seller_hub' | 'paste';
      orderId?: string;
      detailsUrl?: string;
      matchedSnippet?: string;
      payout: EbaySellerHubPayout;
    }
  | {
      ok: false;
      code: string;
      openUrl?: string;
      hint?: string;
      error?: string;
      preview?: string;
      scanned?: number;
      candidates?: SellerHubFetchCandidate[];
    };

export async function fetchEbaySellerHubPayout(input: {
  orderId?: string;
  title?: string;
  sku?: string;
  listingId?: string;
  query?: string;
  payoutText?: string;
}): Promise<SellerHubFetchResult> {
  const res = await fetch('/api/ebay-seller-hub-fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = (await res.json().catch(() => null)) as SellerHubFetchResult | { error?: string } | null;
  if (!data || typeof data !== 'object') {
    return {
      ok: false,
      code: 'scrape_error',
      openUrl: EBAY_SELLER_HUB_ORDERS_URL,
      hint: 'Seller Hub fetch did not return JSON. Use npm run dev:ebay and click Bind again.',
    };
  }
  if ('ok' in data) return data;
  return {
    ok: false,
    code: 'scrape_error',
    openUrl: EBAY_SELLER_HUB_ORDERS_URL,
    error: data.error || `HTTP ${res.status}`,
  };
}
