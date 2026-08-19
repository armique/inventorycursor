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
  username: string | null;
  fullName: string | null;
  address: string | null;
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
export function extractHubBuyer(text: string): {
  username: string | null;
  fullName: string | null;
  address: string | null;
};
export function looksLikeJunkPerson(value: unknown): boolean;
export const EBAY_DE_BUSINESS_TX_FEE_FROM: string;
export const EBAY_DE_BUSINESS_TX_FEE_FROM_ORDER: string;
export function parseGermanHubDate(str: string | null | undefined): string | null;
export function extractHubOrderLifecycle(text: string): {
  creationDate: string | null;
  status: 'cancelled' | 'refunded_full' | 'refunded_partial' | 'active' | 'unknown';
  refundEur: number | null;
  cancelState: string | null;
  orderFulfillmentStatus: string | null;
  orderPaymentStatus: string | null;
};
export function applyBusinessTxFeePolicy<T extends { transactionFeeEur?: number | null }>(
  payout: T,
  creationDate: string | null | undefined
): T;
export function parseEbaySellerHubPayoutText(text: string): EbaySellerHubPayout;
export function payoutLooksComplete(payout: EbaySellerHubPayout | null | undefined): boolean;
export const HUB_PAYOUT_VISION_PROMPT: string;
export function payoutFromHubVisionJson(raw: unknown, orderId?: string | null): EbaySellerHubPayout;
export function labeledTextFromUnknown(value: unknown): string;
export function harvestPayoutFromCapturedPayload(raw: unknown): EbaySellerHubPayout;
export function hubOrderRowsFromUnknown(value: unknown): SellerHubOrderRow[];
export function extractHubListingTitle(
  text: string,
  extras?: {
    snippet?: string;
    payloads?: unknown[];
    candidates?: string[];
    orderId?: string;
  }
): string;
export function pickRicherPayout(
  current: EbaySellerHubPayout | null | undefined,
  incoming: EbaySellerHubPayout | null | undefined
): EbaySellerHubPayout | null | undefined;
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
