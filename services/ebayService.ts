
/**
 * eBay Integration Service
 * Uses local Node.js backend proxy to handle CORS and requests.
 */

// We point to our own server route. The server handles the actual call to api.ebay.com
const PROXY_BASE = '/api/ebay'; 

const getEbayConfig = () => {
  const saved = localStorage.getItem('ebay_config');
  if (saved) {
    return JSON.parse(saved);
  }
  return { token: '' };
};

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

export const testEbayConnection = async () => {
  // Test connection via our proxy
  return await makeRequest('https://api.ebay.com/sell/inventory/v1/inventory_item?limit=1', {
    method: 'GET'
  });
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
