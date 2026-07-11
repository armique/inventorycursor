/**
 * eBay Integration Service
 * Uses local Node.js backend proxy to handle CORS and requests.
 */

import { matchEbayListingsForItem } from '../utils/ebayListingMatch';
import { roundPriceCentsTo99 } from '../utils/ebayPrice';

// We point to our own server route. The server handles the actual call to api.ebay.com
const PROXY_BASE = '/api/ebay'; 

export interface EbayConfig {
  token?: string;
  username?: string;
}

const DEFAULT_EBAY_USERNAME = 'rm4ik';

const getEbayConfig = (): EbayConfig => {
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

export function saveEbayConfig(updates: Partial<EbayConfig>): void {
  const prev = getEbayConfig();
  localStorage.setItem(
    'ebay_config',
    JSON.stringify({
      token: updates.token !== undefined ? updates.token.trim() : prev.token || '',
      username:
        updates.username !== undefined
          ? updates.username.trim().replace(/^@/, '') || DEFAULT_EBAY_USERNAME
          : prev.username || DEFAULT_EBAY_USERNAME,
    })
  );
}

export function getEbayToken(): string | null {
  const config = getEbayConfig();
  const token = config?.token?.trim();
  return token || null;
}

export function hasEbayToken(): boolean {
  return Boolean(getEbayToken());
}

const makeRequest = async (endpoint: string, options: RequestInit) => {
  const config = getEbayConfig();
  
  // The server expects the eBay endpoint path (e.g. /offer)
  // endpoint passed here is like: https://api.ebay.com/sell/inventory/v1/offer
  // We need to strip the domain to pass just the path to our proxy
  const relativePath = endpoint.replace('https://api.ebay.com/sell/inventory/v1', '');

  try {
    const response = await fetch(`${PROXY_BASE}${relativePath}`, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${config.token}`, // Pass token to our server
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
  buyer: { username: string; fullName?: string; address?: string; email?: string; phone?: string };
  lineItems: { sku: string | null; title: string; lineItemCost: number | null }[];
}

/** List orders from eBay Fulfillment API (last 7 days by default). */
export const listEbayOrders = async (fromDate?: string, toDate?: string): Promise<EbayOrderSummary[]> => {
  const config = getEbayConfig();
  if (!config?.token) {
    throw new Error('eBay token not configured. Add your token in Settings.');
  }
  const res = await fetch('/api/ebay-orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: config.token, fromDate, toDate }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Failed to fetch orders: ${res.status}`);
  }
  return data.orders || [];
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
  const config = getEbayConfig();
  if (!config?.token) {
    throw new Error('eBay token not configured. Add your token in Settings.');
  }
  const res = await fetch('/api/ebay-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId: orderId.trim(), token: config.token }),
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
  const listings = await fetchMyEbayListings();
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

/** Fetch active eBay listings from the seller store (Browse API) plus optional OAuth inventory. */
export async function fetchMyEbayListings(): Promise<EbayMyListing[]> {
  const token = getEbayToken();
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
