export const EBAY_SELLER_HUB_ORDERS_URL: string;

export type EbaySellerHubPayout = {
  itemGrossEur: number | null;
  buyerShippingEur: number | null;
  buyerTotalEur: number | null;
  transactionFeeEur: number | null;
  adFeeEur: number | null;
  shippingLabelEur: number | null;
  otherFeeEur: number | null;
  netPayoutEur: number | null;
  orderId: string | null;
  rawMatched: boolean;
};

export type SellerHubMatchQuery = {
  orderId?: string;
  sku?: string;
  listingId?: string;
  title?: string;
  query?: string;
};

export type SellerHubOrderRow = {
  orderId: string;
  snippet?: string;
  href?: string;
  score?: number;
};

export function parseEbayMoney(raw: string | null | undefined): number | null;
export function parseEbaySellerHubPayoutText(text: string): EbaySellerHubPayout;
export function payoutLooksComplete(payout: EbaySellerHubPayout | null | undefined): boolean;
export function tokenizeMatchQuery(value: string): string[];
export function scoreSellerHubOrderRow(row: SellerHubOrderRow, query: SellerHubMatchQuery): number;
export function pickSellerHubMatch(
  rows: SellerHubOrderRow[],
  query: SellerHubMatchQuery
): {
  status: 'exact' | 'ambiguous' | 'none';
  match: (SellerHubOrderRow & { score: number }) | null;
  candidates: Array<SellerHubOrderRow & { score: number }>;
};
