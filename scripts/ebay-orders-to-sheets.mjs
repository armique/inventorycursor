/**
 * Export eBay seller orders (from a start year, default 2026) into a new Google Sheet.
 * (No API? Use your logged-in browser instead: `npm run ebay:browser-export`.)
 *
 * Prerequisites:
 * 1) eBay: User OAuth access token with scope sell.fulfillment or sell.fulfillment.readonly
 *    (same type as DeInventory Settings → eBay). Tokens expire; refresh via your eBay app if needed.
 * 2) Google Cloud: enable Google Sheets API + Google Drive API; create a service account;
 *    download JSON key; share is optional if you set GOOGLE_SHARE_WITH_EMAIL.
 *
 * Usage (from repo root):
 *   npm run ebay:export-sheets
 *
 * Config: copy scripts/ebay-orders-to-sheets.env.example → scripts/.env.ebay-sheets and fill in values,
 * or set the same variables in .env / environment.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });
dotenv.config({ path: resolve(__dirname, '.env.ebay-sheets') });

const EBAY_TOKEN = process.env.EBAY_OAUTH_TOKEN?.trim();
const FROM_YEAR = parseInt(process.env.EBAY_FROM_YEAR || '2026', 10);
const TO_DATE = process.env.EBAY_TO_DATE?.trim(); // optional YYYY-MM-DD
const KEY_PATH =
  process.env.GOOGLE_SERVICE_ACCOUNT_PATH?.trim() ||
  process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
const SHARE_WITH = process.env.GOOGLE_SHARE_WITH_EMAIL?.trim();

function requireEnv(name, value) {
  if (!value) {
    console.error(`Missing ${name}. See scripts/ebay-orders-to-sheets.env.example`);
    process.exit(1);
  }
}

/**
 * @param {string} token
 * @param {string} fromISO
 * @param {string} toISO
 */
async function fetchAllEbayOrders(token, fromISO, toISO) {
  const filter = `creationdate:[${fromISO}..${toISO}]`;
  const allOrders = [];
  let offset = 0;
  const limit = 100;

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
      const t = await ebayRes.text();
      throw new Error(`eBay 401 (token expired or invalid). Re-authenticate. ${t.slice(0, 200)}`);
    }
    if (!ebayRes.ok) {
      const errText = await ebayRes.text();
      let errMsg = `eBay API error ${ebayRes.status}`;
      try {
        const errJson = JSON.parse(errText);
        errMsg = errJson.errors?.[0]?.message || errJson.message || errMsg;
      } catch {
        errMsg += `: ${errText.slice(0, 300)}`;
      }
      throw new Error(errMsg);
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
        lineItemId: li.lineItemId || '',
        sku: li.sku || '',
        title: li.title || '',
        quantity: li.quantity != null ? Number(li.quantity) : 1,
        lineItemCost: li.lineItemCost?.value != null ? parseFloat(li.lineItemCost.value) : null,
        currency: li.lineItemCost?.currency || 'EUR',
      }));

      allOrders.push({
        orderId: order.orderId,
        creationDate: order.creationDate ? order.creationDate.split('T')[0] : '',
        orderFulfillmentStatus: order.orderFulfillmentStatus || '',
        buyerUsername: order.buyer?.username || '',
        buyerFullName: fullName.trim(),
        buyerEmail: shipTo?.email || order.buyer?.buyerRegistrationAddress?.email || '',
        buyerPhone:
          shipTo?.primaryPhone?.phoneNumber ||
          order.buyer?.buyerRegistrationAddress?.primaryPhone?.phoneNumber ||
          '',
        shipToAddress: addressLines.trim(),
        lineItems,
      });
    }

    if (orders.length < limit) break;
    offset += limit;
  }

  return allOrders;
}

function flattenRows(orders) {
  const headers = [
    'orderId',
    'creationDate',
    'orderFulfillmentStatus',
    'buyerUsername',
    'buyerFullName',
    'buyerEmail',
    'buyerPhone',
    'shipToAddress',
    'lineItemId',
    'sku',
    'title',
    'quantity',
    'lineItemCost',
    'currency',
  ];
  const rows = [headers];
  for (const o of orders) {
    if (!o.lineItems.length) {
      rows.push([
        o.orderId,
        o.creationDate,
        o.orderFulfillmentStatus,
        o.buyerUsername,
        o.buyerFullName,
        o.buyerEmail,
        o.buyerPhone,
        o.shipToAddress,
        '',
        '',
        '',
        '',
        '',
        '',
      ]);
      continue;
    }
    for (const li of o.lineItems) {
      rows.push([
        o.orderId,
        o.creationDate,
        o.orderFulfillmentStatus,
        o.buyerUsername,
        o.buyerFullName,
        o.buyerEmail,
        o.buyerPhone,
        o.shipToAddress,
        li.lineItemId,
        li.sku,
        li.title,
        String(li.quantity),
        li.lineItemCost != null ? String(li.lineItemCost) : '',
        li.currency,
      ]);
    }
  }
  return rows;
}

function summaryRows(orders) {
  const headers = [
    'orderId',
    'creationDate',
    'orderFulfillmentStatus',
    'buyerUsername',
    'buyerFullName',
    'lineItemCount',
    'orderLineTotal',
    'currency',
  ];
  const rows = [headers];
  for (const o of orders) {
    let sum = 0;
    let currency = 'EUR';
    for (const li of o.lineItems) {
      if (li.lineItemCost != null) sum += li.lineItemCost;
      if (li.currency) currency = li.currency;
    }
    rows.push([
      o.orderId,
      o.creationDate,
      o.orderFulfillmentStatus,
      o.buyerUsername,
      o.buyerFullName,
      String(o.lineItems.length),
      sum ? String(Math.round(sum * 100) / 100) : '',
      currency,
    ]);
  }
  return rows;
}

async function main() {
  requireEnv('EBAY_OAUTH_TOKEN', EBAY_TOKEN);
  requireEnv('GOOGLE_SERVICE_ACCOUNT_PATH or GOOGLE_APPLICATION_CREDENTIALS', KEY_PATH);
  if (!existsSync(KEY_PATH)) {
    console.error(`Service account file not found: ${KEY_PATH}`);
    process.exit(1);
  }

  const from = new Date(Date.UTC(FROM_YEAR, 0, 1, 0, 0, 0, 0));
  const to = TO_DATE ? new Date(TO_DATE + 'T23:59:59.999Z') : new Date();
  const fromISO = from.toISOString();
  const toISO = to.toISOString();

  console.log(`Fetching eBay orders from ${fromISO} to ${toISO} …`);
  const orders = await fetchAllEbayOrders(EBAY_TOKEN, fromISO, toISO);
  console.log(`Fetched ${orders.length} orders.`);

  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_PATH,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file',
    ],
  });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });
  const drive = google.drive({ version: 'v3', auth: client });

  const title = `eBay orders ${FROM_YEAR}+ ${new Date().toISOString().slice(0, 10)}`;
  const create = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title },
      sheets: [
        { properties: { title: 'Line items', gridProperties: { frozenRowCount: 1 } } },
        { properties: { title: 'Orders summary', gridProperties: { frozenRowCount: 1 } } },
      ],
    },
  });

  const spreadsheetId = create.data.spreadsheetId;
  const lineValues = flattenRows(orders);
  const summaryValues = summaryRows(orders);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "'Line items'!A1",
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: lineValues },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "'Orders summary'!A1",
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: summaryValues },
  });

  if (SHARE_WITH) {
    try {
      await drive.permissions.create({
        fileId: spreadsheetId,
        requestBody: {
          type: 'user',
          role: 'writer',
          emailAddress: SHARE_WITH,
        },
        sendNotificationEmail: true,
      });
      console.log(`Shared spreadsheet with ${SHARE_WITH}.`);
    } catch (e) {
      console.warn('Could not share automatically (enable Drive API for the project, or share manually):', e.message);
    }
  }

  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  console.log('\nDone.');
  console.log(`Open: ${url}`);
  if (!SHARE_WITH) {
    console.log(
      'Tip: set GOOGLE_SHARE_WITH_EMAIL to your Gmail so the service account shares the file with you.'
    );
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
