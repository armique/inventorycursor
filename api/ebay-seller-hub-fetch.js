/**
 * Local Seller Hub: single-order payout, incremental archive scrape, bookmarklet inbox.
 * Playwright needs Chrome with --remote-debugging-port=9222; Vercel always returns local_only.
 *
 * Routes (Hobby: one serverless function):
 *   POST /api/ebay-seller-hub-fetch              — paste parse or CDP single-order fetch
 *   POST /api/ebay-hub-archive-sync               — incremental Hub scrape (rewrite)
 *   GET/POST /api/ebay-hub-browser-ingest         — bookmarklet inbox (rewrite)
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import {
  EBAY_SELLER_HUB_ORDERS_URL,
  parseEbaySellerHubPayoutText,
  payoutLooksComplete,
} from '../lib/ebaySellerHubPayout.js';

let pendingIngest = null;

function cors(res, methods) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function routeOf(req) {
  const q = req.query?.route;
  if (Array.isArray(q)) return String(q[0] || '');
  return String(q || '');
}

function bodyOf(req) {
  if (req.body == null) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body || '{}');
    } catch {
      return {};
    }
  }
  return req.body;
}

function lastJsonLine(stdout) {
  const lines = String(stdout || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.startsWith('{')) continue;
    try {
      return JSON.parse(line);
    } catch {
      /* keep looking */
    }
  }
  return null;
}

function runScrape(payload, timeoutMs = 60000) {
  const script = resolve(process.cwd(), 'scripts/ebay-seller-hub-fetch.mjs');
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [script], {
      cwd: process.cwd(),
      env: process.env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolvePromise({
        ok: false,
        code: 'scrape_error',
        openUrl: EBAY_SELLER_HUB_ORDERS_URL,
        error: err.message,
      });
    });
    child.on('close', () => {
      clearTimeout(timer);
      const line = stdout
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .pop();
      if (!line) {
        resolvePromise({
          ok: false,
          code: 'scrape_error',
          openUrl: EBAY_SELLER_HUB_ORDERS_URL,
          error: stderr.slice(0, 400) || 'No output from Seller Hub scrape',
        });
        return;
      }
      try {
        resolvePromise(JSON.parse(line));
      } catch {
        resolvePromise({
          ok: false,
          code: 'scrape_error',
          openUrl: EBAY_SELLER_HUB_ORDERS_URL,
          error: 'Could not parse scrape output',
          preview: line.slice(0, 400),
        });
      }
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

function runIncremental(payload, timeoutMs = 180000) {
  const script = resolve(process.cwd(), 'scripts/ebay-hub-archive-export.mjs');
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [script, '--incremental'], {
      cwd: process.cwd(),
      env: { ...process.env, HUB_INCREMENTAL: '1' },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolvePromise({
        ok: false,
        code: 'scrape_error',
        openUrl: EBAY_SELLER_HUB_ORDERS_URL,
        error: err.message,
      });
    });
    child.on('close', () => {
      clearTimeout(timer);
      const parsed = lastJsonLine(stdout);
      if (parsed) {
        resolvePromise(parsed);
        return;
      }
      resolvePromise({
        ok: false,
        code: 'scrape_error',
        openUrl: EBAY_SELLER_HUB_ORDERS_URL,
        error: stderr.slice(-400) || 'No output from Hub incremental scrape',
        hint: 'Start debug Chrome with npm run chrome:cdp and stay logged into eBay.de.',
      });
    });
    child.stdin.write(
      JSON.stringify({
        incremental: true,
        fromDate: payload.fromDate,
        toDate: payload.toDate,
        knownOrderIds: payload.knownOrderIds,
        limit: payload.limit,
      })
    );
    child.stdin.end();
  });
}

async function handleBrowserIngest(req, res) {
  cors(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (process.env.VERCEL) {
    return res.status(200).json({
      ok: false,
      code: 'local_only',
      hint: 'Bookmarklet auto-send needs the local app (npm run dev). Copy/paste the dump in eBay Tools instead.',
    });
  }

  if (req.method === 'POST') {
    const body = bodyOf(req);
    if (!body || body.kind !== 'inventory-pro-ebay-hub-browser-dump' || !Array.isArray(body.pages)) {
      return res.status(400).json({ ok: false, error: 'Expected a Hub browser dump.' });
    }
    pendingIngest = body;
    return res.status(200).json({ ok: true, pages: body.pages.length });
  }

  if (req.method === 'GET') {
    const dump = pendingIngest;
    pendingIngest = null;
    return res.status(200).json({ ok: true, dump: dump || null });
  }

  res.setHeader('Allow', 'GET, POST, OPTIONS');
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleArchiveSync(req, res) {
  cors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (process.env.VERCEL) {
    return res.status(200).json({
      ok: false,
      code: 'local_only',
      openUrl: EBAY_SELLER_HUB_ORDERS_URL,
      hint: 'Hub fee scrape needs npm run dev:ebay (Chrome on port 9222, logged into eBay.de).',
    });
  }

  const body = bodyOf(req);
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = String(body.fromDate || today).slice(0, 10);
  const toDate = String(body.toDate || today).slice(0, 10);
  const knownOrderIds = Array.isArray(body.knownOrderIds)
    ? body.knownOrderIds.map((id) => String(id).trim()).filter(Boolean)
    : [];
  const limit = Number(body.limit) > 0 ? Number(body.limit) : undefined;

  const result = await runIncremental({ fromDate, toDate, knownOrderIds, limit });
  return res.status(200).json(result);
}

async function handleSellerHubFetch(req, res) {
  cors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = bodyOf(req);
  const payoutText = String(body.payoutText || body.text || '').trim();
  if (payoutText) {
    const payout = parseEbaySellerHubPayoutText(payoutText);
    if (!payoutLooksComplete(payout)) {
      return res.status(422).json({
        ok: false,
        code: 'parse_failed',
        hint: 'Could not find Gesamtbetrag / fees / Bestelleinnahmen in the pasted text.',
      });
    }
    return res.status(200).json({ ok: true, source: 'paste', payout });
  }

  if (process.env.VERCEL) {
    return res.status(200).json({
      ok: false,
      code: 'local_only',
      openUrl: EBAY_SELLER_HUB_ORDERS_URL,
      hint: 'Live Seller Hub scrape needs npm run dev:ebay (dedicated Chrome on port 9222). Click Bind again after that Chrome is logged into eBay.de.',
    });
  }

  const payload = {
    orderId: String(body.orderId || '').trim(),
    title: String(body.title || '').trim(),
    sku: String(body.sku || '').trim(),
    listingId: String(body.listingId || body.ebayListingId || '').trim(),
    query: String(body.query || '').trim(),
  };

  if (!payload.orderId && !payload.title && !payload.sku && !payload.listingId && !payload.query) {
    return res.status(400).json({
      ok: false,
      code: 'need_query',
      openUrl: EBAY_SELLER_HUB_ORDERS_URL,
      hint: 'Need an order id, title, or SKU to find the order.',
    });
  }

  const result = await runScrape(payload);
  return res.status(200).json(result);
}

export default async function handler(req, res) {
  const route = routeOf(req);
  if (route === 'archive-sync') return handleArchiveSync(req, res);
  if (route === 'browser-ingest') return handleBrowserIngest(req, res);
  return handleSellerHubFetch(req, res);
}
