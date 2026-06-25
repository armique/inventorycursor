/**
 * Unified eBay Fulfillment API proxy (single function for Hobby plan limit).
 * Legacy: /api/ebay-order → ?route=order, /api/ebay-orders → ?route=orders
 */

async function handleEbayOrder(req, res) {
  let orderId, token;
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    orderId = body.orderId;
    token = body.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  } else {
    orderId = req.query?.orderId;
    token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.query?.token;
  }

  if (!orderId || !token) {
    return res.status(400).json({ error: 'Missing orderId or token.' });
  }

  const cleanOrderId = String(orderId).trim().replace(/\s/g, '');
  try {
    const ebayRes = await fetch(
      `https://api.ebay.com/sell/fulfillment/v1/order/${encodeURIComponent(cleanOrderId)}`,
      { method: 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    if (ebayRes.status === 404) return res.status(404).json({ error: 'Order not found.' });
    if (ebayRes.status === 401) return res.status(401).json({ error: 'eBay token expired or invalid.' });
    if (!ebayRes.ok) {
      const errText = await ebayRes.text();
      return res.status(ebayRes.status).json({ error: errText.slice(0, 200) });
    }
    const order = await ebayRes.json();
    const shipTo =
      order.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo || order.buyer?.buyerRegistrationAddress;
    const addr = shipTo?.contactAddress;
    const fullName = shipTo?.fullName || order.buyer?.buyerRegistrationAddress?.fullName || '';
    const addressLines = [addr?.addressLine1, addr?.addressLine2, [addr?.postalCode, addr?.city].filter(Boolean).join(' '), addr?.stateOrProvince, addr?.countryCode]
      .filter(Boolean)
      .join('\n');
    const firstLine = order.lineItems?.[0];
    const lineTotal = firstLine?.lineItemCost?.value ? parseFloat(firstLine.lineItemCost.value) : null;
    return res.status(200).json({
      orderId: order.orderId || cleanOrderId,
      buyer: {
        username: order.buyer?.username || '',
        fullName: fullName.trim() || undefined,
        address: addressLines.trim() || undefined,
        email: shipTo?.email || order.buyer?.buyerRegistrationAddress?.email,
        phone: shipTo?.primaryPhone?.phoneNumber || order.buyer?.buyerRegistrationAddress?.primaryPhone?.phoneNumber,
      },
      sellPrice: lineTotal,
      creationDate: order.creationDate ? order.creationDate.split('T')[0] : null,
      lineItemTitle: firstLine?.title,
    });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to fetch eBay order' });
  }
}

async function handleEbayOrders(req, res) {
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
  if (!token) return res.status(400).json({ error: 'Missing token.' });

  const now = new Date();
  const to = toDate ? new Date(toDate) : now;
  const from = fromDate ? new Date(fromDate) : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const filter = `creationdate:[${from.toISOString()}..${to.toISOString()}]`;
  const allOrders = [];
  let offset = 0;
  const limit = 100;

  try {
    for (;;) {
      const url = `https://api.ebay.com/sell/fulfillment/v1/order?filter=${encodeURIComponent(filter)}&limit=${limit}&offset=${offset}`;
      const ebayRes = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (ebayRes.status === 401) return res.status(401).json({ error: 'eBay token expired or invalid.' });
      if (!ebayRes.ok) return res.status(ebayRes.status).json({ error: await ebayRes.text() });
      const data = await ebayRes.json();
      const orders = data.orders || [];
      if (orders.length === 0) break;
      for (const order of orders) {
        const shipTo = order.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo || order.buyer?.buyerRegistrationAddress;
        const addr = shipTo?.contactAddress;
        const fullName = shipTo?.fullName || order.buyer?.buyerRegistrationAddress?.fullName || '';
        const addressLines = [addr?.addressLine1, addr?.addressLine2, [addr?.postalCode, addr?.city].filter(Boolean).join(' '), addr?.stateOrProvince, addr?.countryCode]
          .filter(Boolean)
          .join('\n');
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
          lineItems: (order.lineItems || []).map((li) => ({
            sku: li.sku || li.lineItemId || null,
            title: li.title || '',
            lineItemCost: li.lineItemCost?.value ? parseFloat(li.lineItemCost.value) : null,
          })),
        });
      }
      if (orders.length < limit) break;
      offset += limit;
    }
    return res.status(200).json({ orders: allOrders });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to fetch eBay orders' });
  }
}

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

  const route = String(req.query?.route || 'order').trim();
  if (route === 'orders') return handleEbayOrders(req, res);
  return handleEbayOrder(req, res);
}
