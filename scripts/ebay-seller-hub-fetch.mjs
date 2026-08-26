/**
 * Find one Seller Hub order in the logged-in Chrome tab and print payout JSON.
 *
 * Chrome must be started with remote debugging (your normal profile by default):
 *   npm run chrome:cdp
 *   scripts/Start-Chrome-Hub.bat
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
  harvestPayoutFromCapturedPayload,
  pickRicherPayout,
  extractHubBuyer,
  payoutFromHubVisionJson,
  HUB_PAYOUT_VISION_PROMPT,
} from '../lib/ebaySellerHubPayout.js';
import { getGeminiKeyForServer } from '../lib/geminiServerEnv.js';
import { callGeminiVisionJson } from '../lib/geminiVisionClient.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });
dotenv.config({ path: resolve(__dirname, '.env.browser-scrape') });

const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9222';
const ORDERS_URL = process.env.EBAY_ORDERS_URL || EBAY_SELLER_HUB_ORDERS_URL;
const MAX_SCROLL_ROUNDS = parseInt(process.env.HUB_SCROLL_ROUNDS || '14', 10);
const PAUSE_MS = parseInt(process.env.PAUSE_MS || '700', 10);
const SCRAPE_BUDGET_MS = parseInt(process.env.HUB_SCRAPE_BUDGET_MS || '48000', 10);
const GOTO_TIMEOUT_MS = parseInt(process.env.HUB_GOTO_TIMEOUT_MS || '20000', 10);
const HARD_EXIT_MS = parseInt(process.env.HUB_HARD_EXIT_MS || '56000', 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function detailsUrls(orderId) {
  const id = encodeURIComponent(orderId);
  return [
    `https://www.ebay.de/sh/ord/details?orderid=${id}`,
    `https://www.ebay.de/mesh/ord/details?orderid=${id}`,
    `https://www.ebay.de/sh/ord/d/?orderid=${id}`,
  ];
}

function detailsUrl(orderId) {
  return detailsUrls(orderId)[0];
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
  const main = await Promise.race([
    page.evaluate(() => document.body?.innerText || '').catch(() => ''),
    sleep(2500).then(() => ''),
  ]);
  if (
    /Bestelleinnahmen|Transaktionsgebühren|Lieferadresse|eBay-Nutzername|Nutzername/i.test(main)
  ) {
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
            const text = node.textContent?.trim();
            if (text) parts.push(text);
          }
        };
        walk(document.body);
        return parts.join('\n');
      })
      .catch(() => ''),
    sleep(2000).then(() => ''),
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
        const body = await Promise.race([
          res.text(),
          sleep(1500).then(() => ''),
        ]);
        if (!body || body.length < 40 || body.length > 2_000_000) return;
        if (!/fee|Fee|EUR|€|Betrag|payout|Bestell|transaction|adFee|net|erlös|username|address|Käufer|buyer/i.test(body)) {
          return;
        }
        bag.push(body);
      } catch {
        /* ignore failed body reads */
      }
    })();
  });
}

function mergePayoutAndBuyer(texts, orderId) {
  let payout = bestPayoutFromCaptures(texts);
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

async function revealPayoutUi(page) {
  const labels = [
    'Ihr Verkaufserlös',
    'Verkaufserlös',
    'Bestelleinnahmen',
    'Zahlungsübersicht',
    'Käufer',
    'Lieferadresse',
    'Your earnings',
    'Mehr anzeigen',
    'Show more',
  ];
  for (const label of labels) {
    const loc = page.getByText(label, { exact: false }).first();
    if (await loc.isVisible().catch(() => false)) {
      await loc.click({ timeout: 800 }).catch(() => {});
      await sleep(200);
    }
  }
  const collapsed = page.locator('[aria-expanded="false"], summary');
  const n = Math.min(await collapsed.count().catch(() => 0), 8);
  for (let i = 0; i < n; i++) {
    const el = collapsed.nth(i);
    const text = ((await el.innerText().catch(() => '')) || '').slice(0, 80);
    if (/erlös|käufer|liefer|zahlung|earning|fee|payout|finanz|details/i.test(text)) {
      await el.click({ timeout: 600 }).catch(() => {});
    }
  }
}

async function gotoFast(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT_MS });
    return true;
  } catch {
    try {
      await page.goto(url, { waitUntil: 'commit', timeout: 8000 });
      return true;
    } catch {
      return false;
    }
  }
}

async function waitForPayoutDom(page, timeoutMs = 12000) {
  await page
    .waitForFunction(
      () =>
        /Bestelleinnahmen|Transaktionsgebühren|Ihr Verkaufserlös|Your earnings|Lieferadresse|eBay-Nutzername|Käufer/i.test(
          document.body?.innerText || ''
        ),
      { timeout: timeoutMs }
    )
    .catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: Math.min(4000, timeoutMs) }).catch(() => {});
}

function pageLooksUsable(text) {
  if (!text) return false;
  if (/Seite nicht gefunden|Page not found|\b404\b/i.test(text) && !/Bestellung/i.test(text)) return false;
  return /Bestellung|Käufer|Verkaufserlös|Lieferadresse|eBay/i.test(text);
}

async function payoutFromPageScreenshot(page, orderId) {
  const apiKey = getGeminiKeyForServer();
  if (!apiKey) return null;
  try {
    await page.evaluate(() => {
      const hit = [...document.querySelectorAll('h1,h2,h3,button,summary,div,span')].find((el) =>
        /Bestelleinnahmen|Ihr Verkaufserlös|Lieferadresse/i.test(el.textContent || '')
      );
      hit?.scrollIntoView?.({ block: 'center' });
    }).catch(() => {});
    await sleep(300);
    const buf = await page.screenshot({ type: 'jpeg', quality: 72, fullPage: true });
    const { parsed } = await callGeminiVisionJson({
      apiKey,
      prompt: HUB_PAYOUT_VISION_PROMPT,
      mime: 'image/jpeg',
      base64: Buffer.from(buf).toString('base64'),
      maxOutputTokens: 1200,
    });
    return payoutFromHubVisionJson(parsed, orderId);
  } catch {
    return null;
  }
}

async function pickEbayPage(ctx) {
  const pages = ctx.pages();
  let best = null;
  let bestScore = -1;
  for (const page of pages) {
    const url = page.url() || '';
    let score = 0;
    if (/ebay\.(de|com)/i.test(url)) score += 10;
    if (/\/sh\/ord|\/mesh\/ord/i.test(url)) score += 25;
    if (/\/sh\//i.test(url)) score += 8;
    if (score > bestScore) {
      best = page;
      bestScore = score;
    }
  }
  if (best && bestScore >= 10) return { page: best, owned: false };
  return { page: await ctx.newPage(), owned: true };
}

function withVision(base, vision) {
  if (!vision) return base;
  const money = pickRicherPayout(base, vision) || base;
  return {
    ...money,
    username: money.username || vision.username || base.username,
    fullName: money.fullName || vision.fullName || base.fullName,
    address: money.address || vision.address || base.address,
  };
}

async function scrapeDetails(page, orderId, jsonBag = []) {
  const urls = detailsUrls(orderId);
  let lastText = '';
  let lastUrl = urls[0];
  const deadline = Date.now() + SCRAPE_BUDGET_MS;

  page.setDefaultNavigationTimeout(GOTO_TIMEOUT_MS);
  page.setDefaultTimeout(8000);

  for (let i = 0; i < urls.length; i++) {
    if (Date.now() > deadline - 6000) break;
    const url = urls[i];
    lastUrl = url;
    const ok = await gotoFast(page, url);
    if (!ok) continue;
    const remaining = Math.max(800, deadline - Date.now() - 14000);
    await waitForPayoutDom(page, Math.min(12000, remaining));
    await revealPayoutUi(page);
    lastText = await collectPageText(page);
    const combined = mergePayoutAndBuyer([lastText, ...jsonBag], orderId);
    if (hasFeeSplit(combined)) {
      return { url, text: lastText, payout: combined };
    }
    if (pageLooksUsable(lastText)) {
      if (Date.now() < deadline - 8000) {
        const vision = await payoutFromPageScreenshot(page, orderId);
        const merged = withVision(combined, vision);
        if (hasFeeSplit(merged)) return { url, text: lastText, payout: merged };
      }
      break;
    }
  }

  const combined = mergePayoutAndBuyer([lastText, ...jsonBag], orderId);
  if (!hasFeeSplit(combined) && Date.now() < deadline - 8000) {
    const vision = await payoutFromPageScreenshot(page, orderId);
    return { url: lastUrl, text: lastText, payout: withVision(combined, vision) };
  }
  return { url: lastUrl, text: lastText, payout: combined };
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

function looksLoggedOut(text) {
  if (!text) return true;
  if (/Vom Käufer bezahlt|Bestelleinnahmen|Transaktionsgebühren|Ihr Verkaufserlös|Lieferadresse|eBay-Nutzername/i.test(text)) {
    return false;
  }
  return /Einloggen|Sign in|Anmelden, um fortzufahren/i.test(text) && !/Bestellung/i.test(text);
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
      hint: 'Start with npm run dev:ebay (or Start-eBay-dev.cmd), log into eBay.de in that Chrome window, then click Bind again.',
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

  const jsonBag = [];
  const pickedPage = await pickEbayPage(ctx);
  const page = pickedPage.page;
  attachJsonHarvest(page, jsonBag);
  let keepOpen = !pickedPage.owned;
  const killer = setTimeout(() => {
    keepOpen = true;
    fail('parse_failed', {
      openUrl: query.orderId ? detailsUrl(query.orderId) : ORDERS_URL,
      hint: 'Seller Hub read timed out. Stay logged into eBay in the debug Chrome window, then click Bind again.',
    });
    process.exit(8);
  }, HARD_EXIT_MS);
  try {
    if (query.orderId) {
      const details = await scrapeDetails(page, query.orderId, jsonBag);
      if (looksLoggedOut(details.text)) {
        keepOpen = true;
        fail('not_logged_in', {
          openUrl: details.url,
          hint: 'The eBay Chrome window is not logged in. Sign into eBay.de there, then click Bind again.',
        });
        process.exitCode = 4;
        return;
      }
      if (!payoutLooksComplete(details.payout) || (details.payout.transactionFeeEur == null && details.payout.netPayoutEur == null)) {
        keepOpen = true;
        fail('parse_failed', {
          openUrl: details.url,
          hint: 'Could not read the Hub order this time. Keep that Chrome logged into eBay.de and click Bind again.',
          preview: details.text.replace(/\s+/g, ' ').trim().slice(0, 500),
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

    await gotoFast(page, ORDERS_URL);
    await sleep(800);

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
        keepOpen = true;
        fail('not_logged_in', { openUrl: ORDERS_URL });
        process.exitCode = 4;
        return;
      }
      fail('not_found', {
        hint: 'No matching order on this year’s Hub list. Click Bind again after the orders list has loaded.',
        scanned: byId.size,
      });
      process.exitCode = 6;
      return;
    }

    if (picked.status === 'ambiguous' || !picked.match) {
      fail('ambiguous', {
        hint: 'Several Hub orders look similar. Click the exact order in the list, then Bind again.',
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

    const details = await scrapeDetails(page, picked.match.orderId, jsonBag);
    if (!payoutLooksComplete(details.payout) || (details.payout.transactionFeeEur == null && details.payout.netPayoutEur == null)) {
      keepOpen = true;
      fail('parse_failed', {
        openUrl: details.url,
        orderId: picked.match.orderId,
        hint: 'Found the order but could not read payout numbers. Keep Chrome logged into eBay.de and click Bind again.',
        preview: details.text.replace(/\s+/g, ' ').trim().slice(0, 500),
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
    clearTimeout(killer);
    if (pickedPage.owned && !keepOpen) await page.close().catch(() => {});
  }
}

main().catch((e) => {
  fail('scrape_error', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
