/**
 * One-time Seller Hub dump: every order from FROM date (default 2025-01-01)
 * into data/ebay-orders/ebay-order-archive.json (local DB on this PC, gitignored).
 *
 * Uses the already-logged-in debug Chrome (CDP 9222). Resumes if the file exists.
 * Re-scrapes rows that are missing a sale date, junk buyer names, or cancel/refund status.
 *
 *   npm run chrome:cdp          # once — log into eBay.de in that window
 *   npm run ebay:hub-archive    # full dump (hours if you have many orders)
 *   npm run ebay:hub-archive -- --limit 3   # smoke test
 *
 * Then in the app: eBay Tools → Sales sync → Load Hub JSON (full dump) or Fetch new Hub orders.
 *
 * Incremental (new sales only, CURRENTYEAR first pages):
 *   npm run ebay:hub-sync
 *   node scripts/ebay-hub-archive-export.mjs --incremental
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import dotenv from 'dotenv';
import {
  harvestPayoutFromCapturedPayload,
  parseEbaySellerHubPayoutText,
  payoutLooksComplete,
  pickRicherPayout,
  extractHubBuyer,
  extractHubOrderLifecycle,
  parseGermanHubDate,
  applyBusinessTxFeePolicy,
  looksLikeJunkPerson,
  extractHubListingTitle,
  hubOrderRowsFromUnknown,
} from '../lib/ebaySellerHubPayout.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });
dotenv.config({ path: resolve(__dirname, '.env.browser-scrape') });

export const HUB_ARCHIVE_KIND = 'inventory-pro-ebay-order-archive';

const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9222';
let FROM_DATE = process.env.FROM || process.env.FROM_DATE || '2025-01-01';
let TO_DATE = process.env.TO || process.env.TO_DATE || new Date().toISOString().slice(0, 10);
let INCREMENTAL = false;
const PAUSE_MS = parseInt(process.env.PAUSE_MS || '800', 10);
const ORDER_PAUSE_MS = parseInt(process.env.ORDER_PAUSE_MS || '1400', 10);
const MAX_SCROLL_ROUNDS = parseInt(process.env.MAX_SCROLL_ROUNDS || '36', 10);
const MAX_NEXT_CLICKS = parseInt(process.env.MAX_NEXT_CLICKS || '30', 10);
const GOTO_TIMEOUT_MS = parseInt(process.env.HUB_GOTO_TIMEOUT_MS || '20000', 10);
const SCRAPE_BUDGET_MS = parseInt(process.env.HUB_SCRAPE_BUDGET_MS || '28000', 10);

const OUT_DIR = resolve(__dirname, 'output');
const APP_DB_DIR = resolve(__dirname, '..', 'data', 'ebay-orders');
const OUT_JSON = resolve(OUT_DIR, 'ebay-order-archive.json');
const OUT_CSV = resolve(OUT_DIR, 'ebay-order-archive.csv');
const APP_JSON = resolve(APP_DB_DIR, 'ebay-order-archive.json');
const APP_CSV = resolve(APP_DB_DIR, 'ebay-order-archive.csv');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(msg) {
  const line = `${msg}\n`;
  if (INCREMENTAL) process.stderr.write(line);
  else process.stdout.write(line);
}

function emitIncrementalJson(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function readStdinJson() {
  if (process.stdin.isTTY) return null;
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function addDaysIso(iso, days) {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function parseArgs(argv) {
  const out = { limit: 0, resume: true, incremental: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if ((a === '--limit' || a === '--max') && next) {
      out.limit = parseInt(next, 10) || 0;
      i++;
    } else if (a === '--fresh') {
      out.resume = false;
    } else if (a === '--incremental' || a === '--since-today') {
      out.incremental = true;
    }
  }
  if (process.env.LIMIT) out.limit = parseInt(process.env.LIMIT, 10) || out.limit;
  if (process.env.HUB_INCREMENTAL === '1') out.incremental = true;
  return out;
}

function hubTimeRanges(fromDate, toDate) {
  const fromYear = parseInt(String(fromDate).slice(0, 4), 10);
  const toYear = parseInt(String(toDate).slice(0, 4), 10);
  const thisYear = new Date().getFullYear();
  const ranges = [];
  if (fromYear <= thisYear - 1 && toYear >= thisYear - 1) ranges.push('PREVIOUSYEAR');
  if (toYear >= thisYear) ranges.push('CURRENTYEAR');
  return ranges.length ? ranges : ['CURRENTYEAR'];
}

function listPageUrl(range, offset, limit = 200) {
  const filter = encodeURIComponent(`status:ALL_ORDERS,timerange:${range}`);
  return `https://www.ebay.de/sh/ord/?offset=${offset}&limit=${limit}&filter=${filter}`;
}

function orderIdsFromPayloads(bag) {
  const rows = [];
  const seen = new Set();
  const add = (id, snippet, href) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    rows.push({
      orderId: id,
      snippet: String(snippet || '').replace(/\s+/g, ' ').trim().slice(0, 900),
      href: href || `https://www.ebay.de/sh/ord/details?orderid=${encodeURIComponent(id)}`,
    });
  };
  for (const body of bag) {
    for (const row of hubOrderRowsFromUnknown(body)) {
      add(row.orderId, row.snippet, row.href);
    }
    if (typeof body !== 'string') continue;
    const re = /\b(\d{2}-\d{5}-\d{5})\b/g;
    let m;
    while ((m = re.exec(body))) {
      add(m[1], '', `https://www.ebay.de/sh/ord/details?orderid=${encodeURIComponent(m[1])}`);
    }
  }
  return rows;
}

function detailsUrls(orderId) {
  const id = encodeURIComponent(orderId);
  return [
    `https://www.ebay.de/sh/ord/details?orderid=${id}`,
    `https://www.ebay.de/mesh/ord/details?orderid=${id}`,
    `https://www.ebay.de/sh/ord/d/?orderid=${id}`,
  ];
}

function parseGermanDate(str) {
  return parseGermanHubDate(str);
}

function isoFromSnippet(snippet) {
  return parseGermanDate(snippet);
}

function extractFromPage() {
  function orderIdFromHref(href) {
    if (!href) return null;
    try {
      const u = new URL(href, 'https://www.ebay.de');
      const q = u.searchParams.get('orderid') || u.searchParams.get('orderId');
      if (q) return decodeURIComponent(q);
    } catch {
      /* ignore */
    }
    const m =
      href.match(/[?&]orderid=([^&]+)/i) ||
      href.match(/[?&]orderId=([^&]+)/i) ||
      href.match(/\/order\/([0-9-]+)/i);
    return m ? decodeURIComponent(m[1]) : null;
  }
  const rows = [];
  const seen = new Set();
  const add = (id, snippet, href) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    rows.push({
      orderId: id,
      snippet: String(snippet || '').replace(/\s+/g, ' ').trim().slice(0, 900),
      href: href || `https://www.ebay.de/sh/ord/details?orderid=${encodeURIComponent(id)}`,
    });
  };
  const anchors = Array.from(
    document.querySelectorAll('a[href*="orderid"], a[href*="orderId"], a[href*="/sh/ord/d"], a[href*="/mesh/ord"]')
  );
  for (const a of anchors) {
    const id = orderIdFromHref(a.href);
    if (!id) continue;
    const block =
      a.closest('[data-testid*="order"]') ||
      a.closest('article') ||
      a.closest('[class*="order"]') ||
      a.closest('tr') ||
      a.parentElement?.parentElement?.parentElement;
    add(id, block?.innerText || a.innerText || '', a.href);
  }
  const root = document.querySelector('main') || document.body;
  const html = root?.innerHTML || '';
  const re = /\b(\d{2}-\d{5}-\d{5})\b/g;
  let m;
  while ((m = re.exec(html))) {
    if (seen.has(m[1])) continue;
    const idx = Math.max(0, m.index - 400);
    const nearby = html.slice(idx, m.index + 400).replace(/<[^>]+>/g, ' ');
    add(m[1], nearby, '');
  }
  return rows;
}

async function collectPageText(page) {
  const main = await Promise.race([
    page.evaluate(() => document.body?.innerText || '').catch(() => ''),
    sleep(2500).then(() => ''),
  ]);
  if (/Bestelleinnahmen|Transaktionsgebühren|Lieferadresse|eBay-Nutzername/i.test(main)) {
    return String(main || '');
  }
  const extra = await Promise.race([
    page
      .evaluate(() => {
        const parts = [];
        const walk = (node) => {
          if (!node) return;
          if (node.shadowRoot) walk(node.shadowRoot);
          if (node.nodeType === 1) {
            for (const child of node.childNodes) walk(child);
          } else if (node.nodeType === 3) {
            const t = node.textContent?.trim();
            if (t) parts.push(t);
          }
        };
        walk(document.body);
        return parts.join('\n');
      })
      .catch(() => ''),
    sleep(1800).then(() => ''),
  ]);
  return `${main || ''}\n${extra || ''}`.trim();
}

function attachJsonHarvest(page, bag) {
  page.on('response', (res) => {
    void (async () => {
      try {
        const url = res.url();
        if (!/ebay\.(de|com)/i.test(url)) return;
        if (/\.(png|jpe?g|gif|webp|css|woff2?|js|map)(\?|$)/i.test(url)) return;
        const status = res.status();
        if (status < 200 || status >= 300) return;
        const ct = res.headers()['content-type'] || '';
        const looksApi =
          /json|graphql/i.test(ct) ||
          /\/sh\/ord|\/mesh\/ord|order_details|selling\/order|fulfillment|finances|graphql/i.test(url);
        if (!looksApi) return;
        const body = await Promise.race([res.text(), sleep(1500).then(() => '')]);
        if (!body || body.length < 40 || body.length > 2_000_000) return;
        if (
          !/fee|Fee|EUR|€|payout|Bestell|transaction|username|address|Käufer|buyer|orderId|orderid|storn|refund|erstatt|title|listing/i.test(
            body
          ) &&
          !/\d{2}-\d{5}-\d{5}/.test(body)
        ) {
          return;
        }
        bag.push(body);
      } catch {
        /* ignore */
      }
    })();
  });
}

async function gotoFast(page, url) {
  if (page.isClosed()) {
    log('  … goto failed: Chrome tab was closed');
    return false;
  }
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT_MS });
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/closed|Target page/i.test(msg)) {
      log(`  … goto failed: ${msg.slice(0, 120)}`);
      return false;
    }
    if (/ERR_ABORTED|interrupted/i.test(msg)) {
      await sleep(600);
      try {
        await page.waitForLoadState('domcontentloaded', { timeout: 8000 });
        return true;
      } catch {
        /* try commit navigation */
      }
    }
    try {
      if (page.isClosed()) return false;
      await page.goto(url, { waitUntil: 'commit', timeout: 12000 });
      return true;
    } catch {
      log(`  … goto failed: ${msg.slice(0, 120)}`);
      return false;
    }
  }
}

async function revealPayoutUi(page) {
  const labels = [
    'Ihr Verkaufserlös',
    'Verkaufserlös',
    'Bestelleinnahmen',
    'Käufer',
    'Lieferadresse',
    'Mehr anzeigen',
    'Show more',
  ];
  for (const label of labels) {
    const loc = page.getByText(label, { exact: false }).first();
    if (await loc.isVisible().catch(() => false)) {
      await loc.click({ timeout: 700 }).catch(() => {});
    }
  }
}

async function waitForPayoutDom(page, timeoutMs = 10000) {
  await page
    .waitForFunction(
      () =>
        /Bestelleinnahmen|Transaktionsgebühren|Ihr Verkaufserlös|Lieferadresse|eBay-Nutzername|Storniert|Erstattet|Rückerstattung/i.test(
          document.body?.innerText || ''
        ),
      { timeout: timeoutMs }
    )
    .catch(() => {});
}

function bestPayoutFromCaptures(texts) {
  let best = parseEbaySellerHubPayoutText('');
  for (const text of texts) {
    best = pickRicherPayout(best, harvestPayoutFromCapturedPayload(text)) || best;
    if (typeof text === 'string') {
      best = pickRicherPayout(best, parseEbaySellerHubPayoutText(text)) || best;
    }
  }
  return best;
}

function mergePayoutAndBuyer(texts, orderId) {
  const payout = bestPayoutFromCaptures(texts);
  const buyer = extractHubBuyer(texts.filter((t) => typeof t === 'string').join('\n\n'));
  return {
    ...payout,
    orderId: payout.orderId || orderId,
    username: payout.username || buyer.username,
    fullName: payout.fullName || buyer.fullName,
    address: payout.address || buyer.address,
  };
}

function hasFeeSplit(payout) {
  return (
    payoutLooksComplete(payout) &&
    (payout.netPayoutEur != null || payout.transactionFeeEur != null)
  );
}

function looksLoggedOut(text) {
  if (!text) return false;
  if (/Vom Käufer bezahlt|Bestelleinnahmen|Transaktionsgebühren|Ihr Verkaufserlös|Lieferadresse/i.test(text)) {
    return false;
  }
  return /Einloggen|Sign in|Anmelden, um fortzufahren/i.test(text) && !/Bestellung/i.test(text);
}

function extractTitleCandidatesFromPage() {
  const out = [];
  const push = (s) => {
    const t = String(s || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (t.length >= 8 && t.length <= 200) out.push(t);
  };
  for (const a of document.querySelectorAll('a[href*="/itm/"], a[href*="itm."], a[href*="item="]')) {
    push(a.getAttribute('aria-label'));
    push(a.getAttribute('title'));
    push(a.textContent);
  }
  for (const img of document.querySelectorAll('img[alt]')) push(img.getAttribute('alt'));
  for (const el of document.querySelectorAll(
    '[data-testid*="title"], [data-testid*="Title"], [class*="item-title"], [class*="listing-title"], [class*="lineItemTitle"]'
  )) {
    push(el.textContent);
  }
  return out;
}

function roundMoney(n) {
  return Math.round(n * 100) / 100;
}

function orderFromPayout(orderId, payout, meta) {
  const importedAt = new Date().toISOString();
  const date = meta.creationDate || null;
  const life = meta.lifecycle || {};
  const feeTotal = roundMoney(
    (payout.transactionFeeEur || 0) +
      (payout.adFeeEur || 0) +
      (payout.shippingLabelEur || 0) +
      (payout.otherFeeEur || 0)
  );
  const events = [];
  const push = (kind, amount, transactionType) => {
    if (amount == null || Math.abs(amount) < 0.01) return;
    const amt = roundMoney(amount);
    events.push({
      id: `${orderId}::${date || 'na'}::${amt.toFixed(2)}::${kind}::${transactionType}`,
      date,
      kind,
      amount: amt,
      transactionType,
      description: 'Seller Hub archive',
      source: 'hub',
      importedAt,
    });
  };
  if (payout.buyerTotalEur != null) push('sale', Math.abs(payout.buyerTotalEur), 'Bestellung');
  if (payout.transactionFeeEur != null) push('fee', -Math.abs(payout.transactionFeeEur), 'Transaktionsgebühren');
  if (payout.adFeeEur != null) push('fee', -Math.abs(payout.adFeeEur), 'Anzeigengebühr Basis');
  if (payout.shippingLabelEur != null) push('fee', -Math.abs(payout.shippingLabelEur), 'Versandetikett');
  if (payout.otherFeeEur != null) push('fee', -Math.abs(payout.otherFeeEur), 'Weitere Gebühren');
  if (life.refundEur != null && life.refundEur >= 0.01) {
    const kind = life.status === 'cancelled' ? 'cancellation' : 'refund';
    push(kind, -Math.abs(life.refundEur), life.status === 'refunded_partial' ? 'Teilweise erstattet' : 'Erstattet');
  }

  const title = (meta.title || '').trim();
  const fullName = looksLikeJunkPerson(payout.fullName) ? undefined : payout.fullName || undefined;
  const username = looksLikeJunkPerson(payout.username) ? undefined : payout.username || undefined;
  return {
    orderId: payout.orderId || orderId,
    creationDate: date,
    buyer: {
      username,
      fullName,
      address: looksLikeJunkPerson(payout.address) ? undefined : payout.address || undefined,
    },
    lineItems: title
      ? [{ sku: null, title, lineItemCost: payout.itemGrossEur ?? null }]
      : [],
    grossTotal: payout.buyerTotalEur ?? payout.itemGrossEur ?? null,
    netTotal: payout.netPayoutEur ?? null,
    feeTotal: feeTotal > 0 ? feeTotal : null,
    shippingCost: payout.shippingLabelEur ?? payout.buyerShippingEur ?? null,
    financialEvents: events.length ? events : undefined,
    orderFulfillmentStatus: life.orderFulfillmentStatus || undefined,
    orderPaymentStatus: life.orderPaymentStatus || undefined,
    cancelState: life.cancelState || undefined,
    sources: ['hub'],
    importedAt,
  };
}

function emptyArchive() {
  return {
    kind: HUB_ARCHIVE_KIND,
    version: 1,
    fromDate: FROM_DATE,
    toDate: TO_DATE,
    exportedAt: new Date().toISOString(),
    orders: [],
    failed: [],
  };
}

function loadArchive(resume) {
  const path = existsSync(OUT_JSON) ? OUT_JSON : existsSync(APP_JSON) ? APP_JSON : null;
  if (!resume || !path) return emptyArchive();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return emptyArchive();
    return {
      ...emptyArchive(),
      ...parsed,
      orders: Array.isArray(parsed.orders) ? parsed.orders : [],
      failed: Array.isArray(parsed.failed) ? parsed.failed : [],
    };
  } catch {
    return emptyArchive();
  }
}

function csvEscape(s) {
  const v = String(s ?? '').replace(/\r?\n/g, ' ').trim();
  if (/[",;]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function writeArchive(doc) {
  mkdirSync(OUT_DIR, { recursive: true });
  doc.exportedAt = new Date().toISOString();
  doc.fromDate = FROM_DATE;
  doc.toDate = TO_DATE;
  writeFileSync(OUT_JSON, JSON.stringify(doc, null, 2), 'utf8');
  const headers = [
    'Order number',
    'Sale date',
    'Status',
    'Buyer username',
    'Buyer name',
    'Ship to address 1',
    'Item title',
    'Total price',
    'Net amount',
    'Final value fee',
    'Ad fee',
    'Shipping',
    'Refund',
  ];
  const lines = [headers.join(',')];
  for (const o of doc.orders) {
    const ads = (o.financialEvents || []).find((e) => /Anzeige/i.test(e.transactionType || ''));
    const tx = (o.financialEvents || []).find((e) => /Transaktion/i.test(e.transactionType || ''));
    const ship = (o.financialEvents || []).find((e) => /Versandetikett/i.test(e.transactionType || ''));
    const refund = (o.financialEvents || []).find((e) => e.kind === 'refund' || e.kind === 'cancellation');
    const status =
      o.cancelState ||
      o.orderPaymentStatus ||
      o.orderFulfillmentStatus ||
      '';
    lines.push(
      [
        o.orderId,
        o.creationDate || '',
        status,
        o.buyer?.username || '',
        o.buyer?.fullName || '',
        o.buyer?.address || '',
        o.lineItems?.[0]?.title || '',
        o.grossTotal ?? '',
        o.netTotal ?? '',
        tx ? Math.abs(tx.amount) : '',
        ads ? Math.abs(ads.amount) : '',
        ship ? Math.abs(ship.amount) : o.shippingCost ?? '',
        refund ? Math.abs(refund.amount) : '',
      ]
        .map(csvEscape)
        .join(',')
    );
  }
  const csv = lines.join('\n');
  writeFileSync(OUT_CSV, csv, 'utf8');
  mkdirSync(APP_DB_DIR, { recursive: true });
  writeFileSync(APP_JSON, JSON.stringify(doc, null, 2), 'utf8');
  writeFileSync(APP_CSV, csv, 'utf8');
}

function orderDone(order) {
  if (!order) return false;
  if (!order.creationDate) return false;
  if (looksLikeJunkPerson(order.buyer?.fullName) && looksLikeJunkPerson(order.buyer?.username)) {
    if (!order.buyer?.address) return false;
  }
  const cancelled = /cancel|storn/i.test(`${order.cancelState || ''} ${order.orderFulfillmentStatus || ''}`);
  const refunded = /refund/i.test(order.orderPaymentStatus || '');
  if (cancelled || refunded) return true;
  if (order.netTotal != null && Number.isFinite(order.netTotal)) return true;
  return (order.financialEvents || []).some((e) => e.kind === 'fee' || e.kind === 'sale');
}

async function scrapeDetails(page, orderId, jsonBag) {
  const urls = detailsUrls(orderId);
  let lastText = '';
  let lastCandidates = [];
  const deadline = Date.now() + SCRAPE_BUDGET_MS;
  page.setDefaultNavigationTimeout(GOTO_TIMEOUT_MS);
  for (const url of urls) {
    if (Date.now() > deadline - 4000) break;
    const ok = await gotoFast(page, url);
    if (!ok) continue;
    await waitForPayoutDom(page, Math.min(10000, Math.max(800, deadline - Date.now() - 8000)));
    await revealPayoutUi(page);
    lastText = await collectPageText(page);
    lastCandidates = await Promise.race([
      page.evaluate(extractTitleCandidatesFromPage).catch(() => []),
      sleep(1500).then(() => []),
    ]);
    const combined = mergePayoutAndBuyer([lastText, ...jsonBag], orderId);
    if (
      hasFeeSplit(combined) ||
      /Lieferadresse|eBay-Nutzername|Storniert|Erstattet|Rückerstattung|Cancelled|Refunded/i.test(lastText)
    ) {
      return { text: lastText, payout: combined, titleCandidates: lastCandidates };
    }
  }
  return {
    text: lastText,
    payout: mergePayoutAndBuyer([lastText, ...jsonBag], orderId),
    titleCandidates: lastCandidates,
  };
}

async function collectOrderIds(page, minNeeded = 0, options = {}) {
  const byId = new Map();
  const merge = (batch) => {
    for (const row of batch) {
      const prev = byId.get(row.orderId);
      const nextTitle = extractHubListingTitle('', { snippet: row.snippet, orderId: row.orderId });
      const prevTitle = prev
        ? extractHubListingTitle('', { snippet: prev.snippet, orderId: prev.orderId })
        : '';
      if (!prev) {
        byId.set(row.orderId, nextTitle ? { ...row, snippet: nextTitle } : row);
        continue;
      }
      if (nextTitle && nextTitle.length >= (prevTitle || '').length) {
        byId.set(row.orderId, { ...row, snippet: nextTitle });
      } else if (!prevTitle && (row.snippet || '').length > (prev.snippet || '').length) {
        byId.set(row.orderId, row);
      }
    }
  };
  page.setDefaultTimeout(2500);
  const listBag = [];
  attachJsonHarvest(page, listBag);
  const incremental = Boolean(options.incremental);
  const ranges = incremental ? ['CURRENTYEAR'] : hubTimeRanges(FROM_DATE, TO_DATE);
  const pageLimit = 200;
  const maxOffset = incremental ? 400 : 4000;
  log(`Hub ranges: ${ranges.join(', ')} (200 per page${incremental ? ', incremental' : ''})`);

  for (const range of ranges) {
    if (minNeeded && byId.size >= minNeeded) break;
    for (let offset = 0; offset < maxOffset; offset += pageLimit) {
      if (minNeeded && byId.size >= minNeeded) break;
      const url = listPageUrl(range, offset, pageLimit);
      listBag.length = 0;
      log(`List ${range} offset ${offset}: ${url}`);
      if (page.isClosed()) {
        throw new Error('The eBay Chrome tab closed. Leave the debug Chrome window open and re-run.');
      }
      const ok = await gotoFast(page, url);
      if (!ok) {
        log('  … page did not load — stopping this range');
        break;
      }
      await sleep(1600);
      const body = await collectPageText(page);
      if (looksLoggedOut(body)) {
        throw new Error('eBay Chrome window is not logged in. Sign into eBay.de there, then re-run.');
      }
      const sizeBefore = byId.size;
      let lastSize = byId.size;
      let stale = 0;
      for (let s = 0; s < Math.min(8, MAX_SCROLL_ROUNDS); s++) {
        merge(await page.evaluate(extractFromPage));
        merge(orderIdsFromPayloads(listBag));
        if (s === 0 || s % 4 === 0) log(`  scroll ${s + 1} · ${byId.size} ids`);
        if (minNeeded && byId.size >= minNeeded) break;
        await page.mouse.wheel(0, 2400);
        await sleep(PAUSE_MS);
        if (byId.size === lastSize) stale += 1;
        else {
          stale = 0;
          lastSize = byId.size;
        }
        if (stale >= 3) break;
      }
      const gained = byId.size - sizeBefore;
      log(`  … ${byId.size} unique id(s) so far (+${gained} this page)`);
      if (gained === 0) {
        log(`  … no new orders on ${range} offset ${offset} — next range`);
        break;
      }
    }
  }
  return [...byId.values()];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  INCREMENTAL = Boolean(args.incremental);
  const stdin = INCREMENTAL && !process.stdin.isTTY ? await readStdinJson() : null;
  if (stdin?.incremental) INCREMENTAL = true;
  if (typeof stdin?.fromDate === 'string' && stdin.fromDate.trim()) {
    FROM_DATE = stdin.fromDate.trim().slice(0, 10);
  }
  if (typeof stdin?.toDate === 'string' && stdin.toDate.trim()) {
    TO_DATE = stdin.toDate.trim().slice(0, 10);
  }
  if (typeof stdin?.limit === 'number' && stdin.limit > 0) args.limit = stdin.limit;
  const knownFromStdin = Array.isArray(stdin?.knownOrderIds)
    ? stdin.knownOrderIds.map((id) => String(id).trim()).filter(Boolean)
    : [];

  log(`Connecting to Chrome at ${CDP_URL}`);
  log(`Date filter ${FROM_DATE} → ${TO_DATE}${args.limit ? ` · limit ${args.limit}` : ''}${INCREMENTAL ? ' · incremental' : ''}`);
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const hint = 'Could not connect. Start debug Chrome first:\n  npm run chrome:cdp\nthen log into eBay.de in that window.';
    if (INCREMENTAL) {
      emitIncrementalJson({
        ok: false,
        code: 'cdp_unavailable',
        error,
        hint: 'Start debug Chrome with npm run chrome:cdp and stay logged into eBay.de.',
        openUrl: 'https://www.ebay.de/sh/ord/?filter=status%3AALL_ORDERS%2Ctimerange%3ACURRENTYEAR',
      });
      process.exit(0);
    }
    console.error(hint, '\n', error);
    process.exit(1);
  }
  const ctx = browser.contexts()[0];
  if (!ctx) {
    const hint = 'No Chrome profile. Open a window in the debug Chrome, then retry.';
    if (INCREMENTAL) {
      emitIncrementalJson({ ok: false, code: 'cdp_unavailable', error: hint, hint });
      process.exit(0);
    }
    console.error(hint);
    process.exit(1);
  }

  const archive = loadArchive(args.resume || INCREMENTAL);
  if (INCREMENTAL && !process.env.FROM && !stdin?.fromDate) {
    const newest = archive.orders
      .map((o) => o.creationDate)
      .filter(Boolean)
      .sort()
      .at(-1);
    if (newest) FROM_DATE = addDaysIso(newest, -1);
  }
  const doneIds = new Set([
    ...knownFromStdin,
    ...archive.orders.filter(orderDone).map((o) => o.orderId),
  ]);
  log(`Resume file: ${doneIds.size} order(s) already saved → ${OUT_JSON}`);

  const page = await ctx.newPage();
  const jsonBag = [];
  attachJsonHarvest(page, jsonBag);

  let stopping = false;
  const stop = () => {
    stopping = true;
    log('\nStopping after this order — progress is saved.');
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  const scraped = [];
  let listedCount = 0;
  try {
    const listed = await collectOrderIds(
      page,
      args.limit > 0 ? doneIds.size + args.limit + 8 : 0,
      { incremental: INCREMENTAL }
    );
    listedCount = listed.length;
    const inRange = listed.filter((row) => {
      const d = isoFromSnippet(row.snippet);
      if (!d) return true;
      return d >= FROM_DATE && d <= TO_DATE;
    });
    const pending = inRange.filter((row) => !doneIds.has(row.orderId));
    const work = args.limit > 0 ? pending.slice(0, args.limit) : pending;
    log(`Listed ${listed.length} · in range ${inRange.length} · still to scrape ${work.length}`);

    for (let i = 0; i < work.length; i++) {
      if (stopping) break;
      const row = work[i];
      jsonBag.length = 0;
      const progress = `[${i + 1}/${work.length}] ${row.orderId} … `;
      if (INCREMENTAL) process.stderr.write(progress);
      else process.stdout.write(progress);
      try {
        const details = await scrapeDetails(page, row.orderId, jsonBag);
        if (looksLoggedOut(details.text)) {
          throw new Error('Logged out mid-run. Sign in again and re-run (resume is automatic).');
        }
        const life = extractHubOrderLifecycle(`${details.text}\n${row.snippet || ''}`);
        const creationDate =
          life.creationDate ||
          isoFromSnippet(details.text) ||
          isoFromSnippet(row.snippet) ||
          parseGermanDate(details.text);
        const payout = applyBusinessTxFeePolicy(details.payout, creationDate);
        const title = extractHubListingTitle(details.text, {
          snippet: row.snippet,
          payloads: jsonBag,
          candidates: details.titleCandidates,
          orderId: row.orderId,
        });
        const order = orderFromPayout(row.orderId, payout, { title, creationDate, lifecycle: life });
        archive.orders = archive.orders.filter((o) => o.orderId !== order.orderId);
        archive.orders.push(order);
        archive.failed = archive.failed.filter((f) => f.orderId !== row.orderId);
        scraped.push(order);
        writeArchive(archive);
        const net = order.netTotal != null ? `net €${order.netTotal}` : 'no net yet';
        const who = order.buyer.fullName || order.buyer.username || 'no name';
        const flag =
          life.status && life.status !== 'unknown' && life.status !== 'active' ? ` · ${life.status}` : '';
        const dateBit = creationDate ? ` · ${creationDate}` : '';
        log(`${net} · ${who}${dateBit}${flag}`);
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        log(`FAIL ${error.slice(0, 160)}`);
        archive.failed = archive.failed.filter((f) => f.orderId !== row.orderId);
        archive.failed.push({ orderId: row.orderId, error, at: new Date().toISOString() });
        writeArchive(archive);
        if (/Logged out/i.test(error)) break;
      }
      await sleep(ORDER_PAUSE_MS);
    }
  } finally {
    await page.close().catch(() => {});
  }

  writeArchive(archive);
  const withFees = archive.orders.filter(orderDone).length;
  const withAddr = archive.orders.filter((o) => o.buyer?.address).length;
  const cancelled = archive.orders.filter((o) => /cancel|storn/i.test(`${o.cancelState || ''} ${o.orderFulfillmentStatus || ''}`)).length;
  const refunded = archive.orders.filter((o) => /refund/i.test(o.orderPaymentStatus || '')).length;
  const withDate = archive.orders.filter((o) => o.creationDate).length;
  log('\n---');
  log(`Saved ${archive.orders.length} order(s) (${withFees} complete, ${withAddr} with address, ${withDate} with date)`);
  log(`Cancelled ${cancelled} · refunded ${refunded}`);
  if (archive.failed.length) log(`Failed this/prior run: ${archive.failed.length} (re-run to retry)`);
  log(`Database: ${APP_JSON}`);
  log(`Copy:     ${OUT_JSON}`);
  log('Import in the app: eBay Tools → Sales sync → Load Hub JSON (or Fetch new Hub orders)');
  log('---\n');
  if (INCREMENTAL) {
    emitIncrementalJson({
      ok: true,
      fromDate: FROM_DATE,
      toDate: TO_DATE,
      listed: listedCount,
      scraped: scraped.length,
      orders: scraped,
      failed: archive.failed.slice(-20),
    });
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
