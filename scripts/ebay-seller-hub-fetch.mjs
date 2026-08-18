/**
 * Find one Seller Hub order in the logged-in Chrome tab and print payout JSON.
 *
 * Chrome must be started with:
 *   chrome.exe --remote-debugging-port=9222
 *
 *   node scripts/ebay-seller-hub-fetch.mjs
 *   (JSON on stdin: { orderId, title, sku, listingId, query })
 *
 *   node scripts/ebay-seller-hub-fetch.mjs --order-id 19-11447-34715
 */
import { chromium } from 'playwright';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  EBAY_SELLER_HUB_ORDERS_URL,
  parseEbaySellerHubPayoutText,
  payoutLooksComplete,
  pickSellerHubMatch,
} from '../lib/ebaySellerHubPayout.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });
dotenv.config({ path: resolve(__dirname, '.env.browser-scrape') });

const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9222';
const ORDERS_URL = process.env.EBAY_ORDERS_URL || EBAY_SELLER_HUB_ORDERS_URL;
const MAX_SCROLL_ROUNDS = parseInt(process.env.HUB_SCROLL_ROUNDS || '14', 10);
const PAUSE_MS = parseInt(process.env.PAUSE_MS || '700', 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function detailsUrl(orderId) {
  return `https://www.ebay.de/mesh/ord/details?orderid=${encodeURIComponent(orderId)}`;
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
  const anchors = Array.from(
    document.querySelectorAll('a[href*="orderid"], a[href*="orderId"], a[href*="/sh/ord/d"], a[href*="/mesh/ord"]')
  );

  for (const a of anchors) {
    const id = orderIdFromHref(a.href);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const block =
      a.closest('[data-testid*="order"]') ||
      a.closest('article') ||
      a.closest('[class*="order"]') ||
      a.closest('tr') ||
      a.parentElement?.parentElement?.parentElement;
    const snippet = (block?.innerText || a.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 900);
    rows.push({ orderId: id, snippet, href: a.href });
  }
  return rows;
}

async function collectPageText(page) {
  const chunks = [];
  for (const frame of page.frames()) {
    const t = await frame.locator('body').innerText({ timeout: 4000 }).catch(() => '');
    if (t && t.trim()) chunks.push(t);
  }
  return chunks.sort((a, b) => b.length - a.length).join('\n\n');
}

function looksLoggedOut(text) {
  if (!text) return true;
  if (/Vom Käufer bezahlt|Bestelleinnahmen|Transaktionsgebühren|Ihr Verkaufserlös/i.test(text)) {
    return false;
  }
  return /Einloggen|Sign in|Anmelden, um fortzufahren/i.test(text) && !/Bestellung/i.test(text);
}

async function scrapeDetails(page, orderId) {
  const url = detailsUrl(orderId);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await sleep(2200);
  let text = await collectPageText(page);
  if (!payoutLooksComplete(parseEbaySellerHubPayoutText(text))) {
    await sleep(1800);
    text = await collectPageText(page);
  }
  const payout = parseEbaySellerHubPayoutText(text);
  if (!payout.orderId) payout.orderId = orderId;
  return { url, text, payout };
}

function parseArgs(argv) {
  const out = { orderId: '', title: '', sku: '', listingId: '', query: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--order-id' && next) {
      out.orderId = next;
      i++;
    } else if (a === '--title' && next) {
      out.title = next;
      i++;
    } else if (a === '--sku' && next) {
      out.sku = next;
      i++;
    } else if (a === '--listing-id' && next) {
      out.listingId = next;
      i++;
    } else if (a === '--query' && next) {
      out.query = next;
      i++;
    }
  }
  return out;
}

async function readStdinJson() {
  if (process.stdin.isTTY) return {};
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const s = Buffer.concat(chunks).toString('utf8').trim();
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

function fail(code, extra = {}) {
  process.stdout.write(JSON.stringify({ ok: false, code, openUrl: ORDERS_URL, ...extra }) + '\n');
}

async function main() {
  const stdin = await readStdinJson();
  const cli = parseArgs(process.argv.slice(2));
  const query = {
    orderId: String(stdin.orderId || cli.orderId || '').trim(),
    title: String(stdin.title || cli.title || '').trim(),
    sku: String(stdin.sku || cli.sku || '').trim(),
    listingId: String(stdin.listingId || cli.listingId || '').trim(),
    query: String(stdin.query || cli.query || '').trim(),
  };

  if (!query.orderId && !query.title && !query.sku && !query.listingId && !query.query) {
    fail('need_query', { hint: 'Pass orderId, title, sku, or query so the matching order can be found.' });
    process.exitCode = 2;
    return;
  }

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
  } catch (e) {
    fail('cdp_unavailable', {
      hint:
        'Start Chrome with --remote-debugging-port=9222 (quit all Chrome windows first), log into eBay, then retry. You can also paste the payout block from Seller Hub.',
      error: e instanceof Error ? e.message : String(e),
    });
    process.exitCode = 3;
    return;
  }

  const ctx = browser.contexts()[0];
  if (!ctx) {
    fail('cdp_unavailable', { hint: 'No Chrome profile/context. Open a window in the debug Chrome, then retry.' });
    process.exitCode = 3;
    return;
  }

  const page = await ctx.newPage();
  try {
    if (query.orderId) {
      const details = await scrapeDetails(page, query.orderId);
      if (looksLoggedOut(details.text)) {
        fail('not_logged_in', { openUrl: details.url });
        process.exitCode = 4;
        return;
      }
      if (!payoutLooksComplete(details.payout)) {
        fail('parse_failed', {
          openUrl: details.url,
          hint: 'Opened the order but could not read the payout block. Paste Vom Käufer bezahlt … Bestelleinnahmen.',
          preview: details.text.replace(/\s+/g, ' ').trim().slice(0, 400),
        });
        process.exitCode = 5;
        return;
      }
      process.stdout.write(
        JSON.stringify({
          ok: true,
          source: 'seller_hub',
          orderId: details.payout.orderId || query.orderId,
          detailsUrl: details.url,
          payout: details.payout,
        }) + '\n'
      );
      return;
    }

    await page.goto(ORDERS_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await sleep(1800);

    const searchText = query.query || query.sku || query.title;
    if (searchText) {
      const search = page
        .locator('input[type="search"], input[placeholder*="Suchen"], input[aria-label*="Suchen"], input[placeholder*="Search"]')
        .first();
      if (await search.isVisible().catch(() => false)) {
        await search.fill(searchText).catch(() => {});
        await page.keyboard.press('Enter').catch(() => {});
        await sleep(1600);
      }
    }

    const byId = new Map();
    const merge = (batch) => {
      for (const row of batch) {
        const prev = byId.get(row.orderId);
        if (!prev || (row.snippet || '').length > (prev.snippet || '').length) byId.set(row.orderId, row);
      }
    };

    for (let s = 0; s < MAX_SCROLL_ROUNDS; s++) {
      merge(await page.evaluate(extractFromPage));
      const picked = pickSellerHubMatch([...byId.values()], query);
      if (picked.status === 'exact' && picked.match) break;
      await page.mouse.wheel(0, 2200);
      await sleep(PAUSE_MS);
    }

    const picked = pickSellerHubMatch([...byId.values()], query);
    if (picked.status === 'none' || !picked.candidates.length) {
      const listText = await collectPageText(page);
      if (looksLoggedOut(listText)) {
        fail('not_logged_in', { openUrl: ORDERS_URL });
        process.exitCode = 4;
        return;
      }
      fail('not_found', {
        hint: 'No matching order on this year’s list. Open Seller Hub, find the order, and paste the payout block.',
        scanned: byId.size,
      });
      process.exitCode = 6;
      return;
    }

    if (picked.status === 'ambiguous' || !picked.match) {
      fail('ambiguous', {
        hint: 'Several orders look similar — pick one, or paste the payout block.',
        candidates: picked.candidates.map((c) => ({
          orderId: c.orderId,
          snippet: (c.snippet || '').slice(0, 220),
          href: c.href || detailsUrl(c.orderId),
          score: c.score,
        })),
      });
      process.exitCode = 7;
      return;
    }

    const details = await scrapeDetails(page, picked.match.orderId);
    if (!payoutLooksComplete(details.payout)) {
      fail('parse_failed', {
        openUrl: details.url,
        orderId: picked.match.orderId,
        hint: 'Found the order but could not read payout numbers. Paste the block from the order page.',
        preview: details.text.replace(/\s+/g, ' ').trim().slice(0, 400),
      });
      process.exitCode = 5;
      return;
    }

    process.stdout.write(
      JSON.stringify({
        ok: true,
        source: 'seller_hub',
        orderId: details.payout.orderId || picked.match.orderId,
        detailsUrl: details.url,
        matchedSnippet: (picked.match.snippet || '').slice(0, 220),
        payout: details.payout,
      }) + '\n'
    );
  } finally {
    await page.close().catch(() => {});
  }
}

main().catch((e) => {
  fail('scrape_error', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
