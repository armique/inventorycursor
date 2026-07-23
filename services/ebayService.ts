/**
 * eBay Integration Service
 * Uses local Node.js backend proxy to handle CORS and requests.
 */

import { matchEbayListingsForItem } from '../utils/ebayListingMatch';
import { ensureEbayListings } from './ebayListingIndex';
import { roundPriceCentsTo99 } from '../utils/ebayPrice';

// We point to our own server route. The server handles the actual call to api.ebay.com
const PROXY_BASE = '/api/ebay';

export interface EbayConfig {
  token?: string;
  username?: string;
  /** Long-lived refresh token from Connect eBay (~18 months). */
  refreshToken?: string;
  /** Access-token expiry (epoch ms). */
  expiresAt?: number;
  /** Refresh-token expiry (epoch ms). */
  refreshExpiresAt?: number;
  connectedAt?: string;
}

const DEFAULT_EBAY_USERNAME = 'rm4ik';
const ACCESS_TOKEN_SKEW_MS = 5 * 60 * 1000;

export const getEbayConfig = (): EbayConfig => {
  const saved = localStorage.getItem('ebay_config');
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (_) {}
  }
  return { token: '', username: DEFAULT_EBAY_USERNAME };
};

export function getEbayUsername(): string {
  const username = getEbayConfig()?.username?.trim().replace(/^@/, '');
  return username || DEFAULT_EBAY_USERNAME;
}

export function saveEbayConfig(updates: Partial<EbayConfig>, opts?: { silent?: boolean }): void {
  const prev = getEbayConfig();
  const next: EbayConfig = {
    token: updates.token !== undefined ? updates.token.trim() : prev.token || '',
    username:
      updates.username !== undefined
        ? updates.username.trim().replace(/^@/, '') || DEFAULT_EBAY_USERNAME
        : prev.username || DEFAULT_EBAY_USERNAME,
    refreshToken:
      updates.refreshToken !== undefined
        ? updates.refreshToken.trim() || undefined
        : prev.refreshToken,
    expiresAt: updates.expiresAt !== undefined ? updates.expiresAt : prev.expiresAt,
    refreshExpiresAt:
      updates.refreshExpiresAt !== undefined ? updates.refreshExpiresAt : prev.refreshExpiresAt,
    connectedAt: updates.connectedAt !== undefined ? updates.connectedAt : prev.connectedAt,
  };
  localStorage.setItem('ebay_config', JSON.stringify(next));
  if (!opts?.silent) {
    window.dispatchEvent(new Event('ebay-config-updated'));
  }
}

export function getEbayToken(): string | null {
  const config = getEbayConfig();
  const token = config?.token?.trim();
  return token || null;
}

export function hasEbayToken(): boolean {
  return Boolean(getEbayToken() || getEbayConfig().refreshToken);
}

export function hasEbayRefreshToken(): boolean {
  return Boolean(getEbayConfig().refreshToken?.trim());
}

export function getEbayConnectionStatus(): {
  connected: boolean;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  accessExpiresAt?: number;
  refreshExpiresAt?: number;
  accessExpired: boolean;
  refreshExpired: boolean;
} {
  const cfg = getEbayConfig();
  const now = Date.now();
  const refreshExpired = Boolean(cfg.refreshExpiresAt && cfg.refreshExpiresAt <= now);
  const accessExpired = Boolean(cfg.expiresAt && cfg.expiresAt <= now + ACCESS_TOKEN_SKEW_MS);
  return {
    connected: Boolean(cfg.refreshToken?.trim() || cfg.token?.trim()),
    hasAccessToken: Boolean(cfg.token?.trim()),
    hasRefreshToken: Boolean(cfg.refreshToken?.trim()),
    accessExpiresAt: cfg.expiresAt,
    refreshExpiresAt: cfg.refreshExpiresAt,
    accessExpired,
    refreshExpired,
  };
}

export function disconnectEbayOAuth(): void {
  const username = getEbayUsername();
  localStorage.setItem(
    'ebay_config',
    JSON.stringify({ token: '', username, refreshToken: undefined, expiresAt: undefined, refreshExpiresAt: undefined })
  );
  window.dispatchEvent(new Event('ebay-config-updated'));
}

export function saveEbayOAuthTokens(data: {
  access_token: string;
  expires_in?: number;
  refresh_token?: string | null;
  refresh_token_expires_in?: number | null;
}): void {
  const prev = getEbayConfig();
  const now = Date.now();
  const expiresIn = Number(data.expires_in) || 7200;
  const refreshExpiresIn = Number(data.refresh_token_expires_in) || undefined;
  saveEbayConfig({
    token: data.access_token,
    expiresAt: now + expiresIn * 1000,
    refreshToken:
      data.refresh_token != null && String(data.refresh_token).trim()
        ? String(data.refresh_token).trim()
        : prev.refreshToken,
    refreshExpiresAt:
      refreshExpiresIn != null
        ? now + refreshExpiresIn * 1000
        : prev.refreshExpiresAt,
    connectedAt: prev.connectedAt || new Date().toISOString(),
  });
}

let refreshInFlight: Promise<string | null> | null = null;

/** Ensure we have a non-expired access token (auto-refresh when Connect eBay was used). */
export async function ensureFreshEbayToken(): Promise<string | null> {
  const cfg = getEbayConfig();
  const token = cfg.token?.trim() || '';
  const now = Date.now();
  if (token && (!cfg.expiresAt || cfg.expiresAt > now + ACCESS_TOKEN_SKEW_MS)) {
    return token;
  }
  if (!cfg.refreshToken?.trim()) {
    return token || null;
  }
  if (cfg.refreshExpiresAt && cfg.refreshExpiresAt <= now) {
    throw new Error('eBay connection expired (~18 months). Click Connect eBay in Settings to reconnect.');
  }
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const res = await fetch('/api/ebay?route=oauth_refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: cfg.refreshToken }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        typeof data.error === 'string'
          ? data.error
          : 'Could not refresh eBay token. Click Connect eBay in Settings.'
      );
    }
    if (!data.access_token) throw new Error('eBay refresh returned no access token.');
    saveEbayOAuthTokens({
      access_token: data.access_token,
      expires_in: data.expires_in,
      refresh_token: data.refresh_token,
      refresh_token_expires_in: data.refresh_token_expires_in,
    });
    return String(data.access_token);
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

/** Build eBay consent URL (server uses EBAY_CLIENT_ID + EBAY_RUNAME). */
export async function fetchEbayAuthorizeUrl(): Promise<{ url: string; configured: boolean }> {
  const res = await fetch('/api/ebay?route=oauth_authorize_url');
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url) {
    throw new Error(
      typeof data.error === 'string'
        ? data.error
        : 'eBay Connect is not configured on the server.'
    );
  }
  return { url: data.url, configured: data.configured !== false };
}

/** Exchange authorization code from /auth/ebay/callback. */
export async function exchangeEbayAuthorizationCode(code: string): Promise<void> {
  const res = await fetch('/api/ebay?route=oauth_exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(typeof data.error === 'string' ? data.error : 'eBay Connect failed.');
  }
  saveEbayOAuthTokens({
    access_token: data.access_token,
    expires_in: data.expires_in,
    refresh_token: data.refresh_token,
    refresh_token_expires_in: data.refresh_token_expires_in,
  });
}

const makeRequest = async (endpoint: string, options: RequestInit) => {
  const token = await ensureFreshEbayToken();
  
  // The server expects the eBay endpoint path (e.g. /offer)
  // endpoint passed here is like: https://api.ebay.com/sell/inventory/v1/offer
  // We need to strip the domain to pass just the path to our proxy
  const relativePath = endpoint.replace('https://api.ebay.com/sell/inventory/v1', '');

  try {
    const response = await fetch(`${PROXY_BASE}${relativePath}`, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${token}`, // Pass token to our server
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Server Error ${response.status}`);
    }
    
    if (response.status === 204) return true;
    return await response.json();
  } catch (e: any) {
    console.error("eBay Request Failed:", e);
    throw e;
  }
};

export const createEbayDraft = async (item: any) => {
  // Generate a SKU if not present.
  const sku = item.ebaySku || `SKU-${item.id.replace(/[^a-zA-Z0-9-]/g, '')}-${Date.now().toString().slice(-4)}`;
  
  // Description
  const description = item.marketDescription || item.comment1 || item.name;
  
  // 1. Create Inventory Item
  await makeRequest(`https://api.ebay.com/sell/inventory/v1/inventory_item/${sku}`, {
    method: 'PUT',
    body: JSON.stringify({
      product: {
        title: (item.marketTitle || item.name).substring(0, 80),
        description: description,
        aspects: {
          'Marke': [item.vendor || 'Markenlos'],
          'Produktart': [item.category || 'Hardware']
        },
      },
      condition: "USED_EXCELLENT",
      availability: { shipToLocationAvailability: { quantity: 1 } }
    })
  });

  // 2. Create Offer
  const offerPayload = {
    sku: sku,
    marketplaceId: "EBAY_DE",
    format: "FIXED_PRICE",
    availableQuantity: 1,
    categoryId: "175673",
    listingDescription: description,
    pricingSummary: {
      price: { value: (item.sellPrice || (item.buyPrice * 1.3)).toFixed(2), currency: "EUR" }
    },
    merchantLocationKey: "default",
    tax: { vatPercentage: 0, applyTax: false }
  };

  const offerData = await makeRequest(`https://api.ebay.com/sell/inventory/v1/offer`, {
    method: 'POST',
    body: JSON.stringify(offerPayload)
  });

  return { sku, offerId: offerData.offerId };
};

/** Single order from listEbayOrders. */
export interface EbayOrderSummary {
  orderId: string;
  creationDate: string | null;
  lastModifiedDate?: string | null;
  orderFulfillmentStatus?: string | null;
  orderPaymentStatus?: string | null;
  cancelState?: string | null;
  buyer: { username: string; fullName?: string; address?: string; email?: string; phone?: string };
  lineItems: { sku: string | null; title: string; lineItemCost: number | null; listingId?: string | null }[];
  /** Full order total (gross, before eBay fees) from the Fulfillment API pricing summary. */
  orderTotal?: number | null;
}

/** List orders from eBay Fulfillment API (last 7 days by default). */
export const listEbayOrders = async (fromDate?: string, toDate?: string): Promise<EbayOrderSummary[]> => {
  const token = await ensureFreshEbayToken();
  if (!token) {
    throw new Error('eBay not connected. Open Settings → Listings sync → Connect eBay.');
  }
  const res = await fetch('/api/ebay-orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, fromDate, toDate }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Failed to fetch orders: ${res.status}`);
  }
  return data.orders || [];
};

/** Buyer-side purchase line from Trading API GetOrders. */
export interface EbayPurchaseSummary {
  lineKey: string;
  orderId: string;
  transactionId?: string | null;
  itemId?: string | null;
  title: string;
  sellerUsername?: string;
  creationDate: string | null;
  quantity: number;
  unitPrice: number | null;
  totalPaid: number | null;
}

/** List items you bought on eBay (Trading API, buyer role). */
export const listEbayPurchases = async (fromDate?: string, toDate?: string): Promise<EbayPurchaseSummary[]> => {
  const token = await ensureFreshEbayToken();
  if (!token) {
    throw new Error('eBay not connected. Open Settings → Listings sync → Connect eBay.');
  }
  const res = await fetch('/api/ebay-purchases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, fromDate, toDate }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Failed to fetch purchases: ${res.status}`);
  }
  return data.purchases || [];
};

/** Response shape from /api/ebay-order. */
export interface EbayOrderData {
  customer: { name: string; address: string; phone?: string; email?: string };
  ebayUsername: string;
  ebayOrderId: string;
  sellPrice?: number;
  sellDate?: string;
}

/** Fetch sold order from eBay Fulfillment API and return buyer + shipping address for SaleModal. */
export const fetchEbayOrder = async (orderId: string): Promise<EbayOrderData> => {
  const token = await ensureFreshEbayToken();
  if (!token) {
    throw new Error('eBay not connected. Open Settings → Listings sync → Connect eBay.');
  }
  const res = await fetch('/api/ebay-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId: orderId.trim(), token }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Failed to fetch order: ${res.status}`);
  }
  return {
    customer: {
      name: data.buyer?.fullName || '',
      address: data.buyer?.address || '',
      phone: data.buyer?.phone,
      email: data.buyer?.email,
    },
    ebayUsername: data.buyer?.username || '',
    ebayOrderId: data.orderId || orderId,
    sellPrice: data.sellPrice,
    sellDate: data.creationDate || undefined,
  };
};

export interface EbayMyListing {
  sku?: string;
  offerId?: string;
  listingId: string;
  title: string;
  thumbnail?: string;
  imageUrls: string[];
  listingUrl?: string;
  price?: number;
  currency?: string;
  source: 'inventory' | 'trading' | 'seller_store';
}

export interface EbayListingPriceMatch {
  listingId: string;
  title: string;
  listingUrl?: string;
  sku?: string;
  rawPrice: number;
  roundedPrice: number;
  currency?: string;
  matchScore: number;
}

let listingsCache: { at: number; listings: EbayMyListing[] } | null = null;
const LISTINGS_CACHE_MS = 90_000;

async function getCachedMyEbayListings(): Promise<EbayMyListing[]> {
  if (listingsCache && Date.now() - listingsCache.at < LISTINGS_CACHE_MS) {
    return listingsCache.listings;
  }
  const { listings } = await ensureEbayListings();
  listingsCache = { at: Date.now(), listings };
  return listings;
}

/** Match an inventory item to a live eBay listing price from the seller store / account. */
export async function fetchEbayListingPriceForItem(
  itemName: string,
  itemSku?: string
): Promise<EbayListingPriceMatch | null> {
  const listings = await getCachedMyEbayListings();
  const priced = listings.filter((l) => l.price != null && l.price > 0);
  const matches = matchEbayListingsForItem(itemName, priced, itemSku);
  if (!matches.length || matches[0].price == null) return null;

  const best = matches[0];
  const rawPrice = best.price!;
  return {
    listingId: best.listingId,
    title: best.title,
    listingUrl: best.listingUrl,
    sku: best.sku,
    rawPrice,
    roundedPrice: roundPriceCentsTo99(rawPrice),
    currency: best.currency,
    matchScore: best.matchScore,
  };
}

/** Build a price match from an already-loaded eBay listing row (e.g. My eBay photos picker). */
export function ebayListingToPriceMatch(
  listing: EbayMyListing & { matchScore?: number }
): EbayListingPriceMatch | null {
  if (listing.price == null || listing.price <= 0) return null;
  const rawPrice = listing.price;
  return {
    listingId: listing.listingId,
    title: listing.title,
    listingUrl: listing.listingUrl,
    sku: listing.sku,
    rawPrice,
    roundedPrice: roundPriceCentsTo99(rawPrice),
    currency: listing.currency,
    matchScore: listing.matchScore ?? 100,
  };
}

/** Fetch active eBay listings from the seller store (Browse API) plus optional OAuth inventory. */
export async function fetchMyEbayListings(): Promise<EbayMyListing[]> {
  const token = await ensureFreshEbayToken();
  const username = getEbayUsername();
  const res = await fetch('/api/ebay-listings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: token || undefined, username }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const hint =
      res.status === 404
        ? 'eBay listings API not available. Restart `npm run dev` (local) or deploy the latest build (Vercel).'
        : typeof data.error === 'string'
          ? data.error
          : undefined;
    throw new Error(hint || `Failed to fetch eBay listings: ${res.status}`);
  }
  return data.listings || [];
}
