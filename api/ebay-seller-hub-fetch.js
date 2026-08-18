/**
 * Local Seller Hub payout fetch (Playwright CDP) + paste parse.
 * Playwright needs Chrome with --remote-debugging-port=9222; Vercel always returns local_only.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import {
  EBAY_SELLER_HUB_ORDERS_URL,
  parseEbaySellerHubPayoutText,
  payoutLooksComplete,
} from '../lib/ebaySellerHubPayout.js';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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

function runScrape(payload, timeoutMs = 90000) {
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

export default async function handler(req, res) {
  cors(res);
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
      hint: 'Live Seller Hub scrape runs on npm run dev with Chrome --remote-debugging-port=9222. Paste the payout block here, or use it locally.',
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
