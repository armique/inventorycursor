/**
 * Vercel serverless: list eBay orders by date range.
 * POST /api/ebay-orders with body: { token, fromDate, toDate }
 * Requires eBay OAuth token with sell.fulfillment or sell.fulfillment.readonly scope.
 * Returns orders with orderId, creationDate, lineItems (sku, title, lineItemCost), buyer.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let token, fromDate, toDate;
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    token = body.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    fromDate = body.fromDate || body.from;
    toDate = body.toDate || body.to;
  } else {
    token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.query?.token;
    fromDate = req.query?.fromDate || req.query?.from;
    toDate = req.query?.toDate || req.query?.to;
  }

  if (!token) {
    return res.status(400).json({ error: 'Missing token. Send POST body: { token, fromDate, toDate }' });
  }

  // Default: last 7 days
  const now = new Date();
  const to = toDate ? new Date(toDate) : now;
  const from = fromDate ? new Date(fromDate) : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fromISO = from.toISOString();
  const toISO = to.toISOString();
  const filter = `creationdate:[${fromISO}..${toISO}]`;

  const allOrders = [];
  let offset = 0;
  const limit = 100;

  try {
    for (;;) {
      const url = `https://api.ebay.com/sell/fulfillment/v1/order?filter=${encodeURIComponent(filter)}&limit=${limit}&offset=${offset}`;
      const ebayRes = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (ebayRes.status === 401) {
        return res.status(401).json({ error: 'eBay token expired or invalid. Re-authenticate.' });
      }
      if (!ebayRes.ok) {
        const errText = await ebayRes.text();
        let errMsg = `eBay API error ${ebayRes.status}`;
        try {
          const errJson = JSON.parse(errText);
          errMsg = errJson.errors?.[0]?.message || errJson.message || errMsg;
        } catch (_) {}
        return res.status(ebayRes.status).json({ error: errMsg });
      }

      const data = await ebayRes.json();
      const orders = data.orders || [];
      if (orders.length === 0) break;

      for (const order of orders) {
        const shipTo =
          order.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo ||
          order.buyer?.buyerRegistrationAddress;
        const addr = shipTo?.contactAddress;
        const fullName = shipTo?.fullName || order.buyer?.buyerRegistrationAddress?.fullName || '';
        const addressLines = [
          addr?.addressLine1,
          addr?.addressLine2,
          [addr?.postalCode, addr?.city].filter(Boolean).join(' '),
          addr?.stateOrProvince,
          addr?.countryCode,
        ]
          .filter(Boolean)
          .join('\n');

        const lineItems = (order.lineItems || []).map((li) => ({
          sku: li.sku || li.lineItemId || null,
          title: li.title || '',
          lineItemCost: li.lineItemCost?.value ? parseFloat(li.lineItemCost.value) : null,
        }));

        allOrders.push({
          orderId: order.orderId,
          creationDate: order.creationDate ? order.creationDate.split('T')[0] : null,
          buyer: {
            username: order.buyer?.username || '',
            fullName: fullName.trim() || undefined,
            address: addressLines.trim() || undefined,
            email: shipTo?.email || order.buyer?.buyerRegistrationAddress?.email,
            phone: shipTo?.primaryPhone?.phoneNumber || order.buyer?.buyerRegistrationAddress?.primaryPhone?.phoneNumber,
          },
          lineItems,
        });
      }

      if (orders.length < limit) break;
      offset += limit;
    }

    return res.status(200).json({ orders: allOrders });
  } catch (e) {
    console.error('eBay orders list error:', e);
    return res.status(500).json({ error: e.message || 'Failed to fetch eBay orders' });
  }
}
