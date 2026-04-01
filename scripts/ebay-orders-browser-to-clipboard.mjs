/**
 * eBay orders → TSV (file + clipboard) using YOUR already-logged-in browser.
 * No eBay API, no Google API. You paste into Google Sheets yourself (cell A1).
 *
 * How it works
 * ------------
 * 1) Fully quit Chrome (or Edge) — all windows.
 * 2) Start the browser with remote debugging (pick ONE):
 *
 *    Chrome (Windows):
 *      "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
 *
 *    Edge (Windows):
 *      "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222
 *
 * 3) In that browser, log into eBay (and open Seller Hub once if needed).
 * 4) Run from repo root:
 *      npm run ebay:browser-export
 *
 * The script opens a new tab, loads your orders page, scrolls and tries “Next”,
 * collects order links/snippets, keeps orders from FROM_YEAR onward (default 2026),
 * writes scripts/output/ebay-orders-paste.tsv and copies TSV to the clipboard.
 *
 * 5) Open a blank Google Sheet → click cell A1 → Ctrl+V (Paste).
 *
 * eBay changes their HTML often; if rows are empty, set EBAY_ORDERS_URL to the
 * exact URL you see when you’re on “All orders” (or sold) in Seller Hub.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import clipboardy from 'clipboardy';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });
dotenv.config({ path: resolve(__dirname, '.env.browser-scrape') });

const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9222';
const ORDERS_URL = process.env.EBAY_ORDERS_URL || 'https://www.ebay.de/sh/ord';
const FROM_YEAR = parseInt(process.env.FROM_YEAR || '2026', 10);
const MAX_SCROLL_ROUNDS = parseInt(process.env.MAX_SCROLL_ROUNDS || '40', 10);
const MAX_NEXT_CLICKS = parseInt(process.env.MAX_NEXT_CLICKS || '25', 10);
const PAUSE_MS = parseInt(process.env.PAUSE_MS || '900', 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** German-style DD.MM.YYYY or DD.MM.YY */
function parseGermanDate(str) {
  if (!str) return null;
  const m = str.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})\b/);
  if (!m) return null;
  let y = parseInt(m[3], 10);
  if (y < 100) y += 2000;
  const d = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  if (mo < 1 || mo > 12) return null;
  return { y, m: mo, d, raw: m[0] };
}

/** Runs in the browser — must be self-contained (no outer closures). */
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
    document.querySelectorAll('a[href*="orderid"], a[href*="orderId"], a[href*="/sh/ord/d"]')
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

    const snippet = (block?.innerText || a.innerText || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 800);

    rows.push({
      orderId: id,
      snippet,
      href: a.href,
    });
  }

  return rows;
}

function tsvEscape(s) {
  return String(s ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\t/g, ' ')
    .trim();
}

function rowPassesYearFilter(snippet) {
  const parsed = parseGermanDate(snippet);
  if (!parsed) return { keep: true, reason: 'no_date' };
  if (parsed.y < FROM_YEAR) return { keep: false, reason: 'too_old' };
  return { keep: true, reason: 'ok', parsed };
}

async function main() {
  console.log(`Connecting to browser at ${CDP_URL} …`);
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
  } catch (e) {
    console.error(
      'Could not connect. Is Chrome/Edge running with --remote-debugging-port=9222 ?\n' +
        'Quit ALL browser windows, then start it from the command line with that flag.\n',
      e.message
    );
    process.exit(1);
  }

  const ctx = browser.contexts()[0];
  if (!ctx) {
    console.error('No browser context found.');
    await browser.close();
    process.exit(1);
  }

  const page = await ctx.newPage();
  console.log(`Opening ${ORDERS_URL} …`);
  await page.goto(ORDERS_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await sleep(2500);

  const byId = new Map();

  const mergeBatch = (batch) => {
    for (const r of batch) {
      const prev = byId.get(r.orderId);
      if (!prev || (r.snippet && r.snippet.length > (prev.snippet?.length || 0))) {
        byId.set(r.orderId, r);
      }
    }
  };

  for (let s = 0; s < MAX_SCROLL_ROUNDS; s++) {
    const batch = await page.evaluate(extractFromPage);
    mergeBatch(batch);
    await page.mouse.wheel(0, 2200);
    await sleep(PAUSE_MS);
    if (s % 8 === 0) {
      process.stdout.write(`\rScrolling… ${byId.size} order link(s) found`);
    }
  }
  console.log('');

  const nextSelectors = [
    'button:has-text("Weiter")',
    'a:has-text("Weiter")',
    'button:has-text("Next")',
    'a:has-text("Next")',
    '[aria-label*="Next"]',
    '[aria-label*="Weiter"]',
  ];

  for (let p = 0; p < MAX_NEXT_CLICKS; p++) {
    let clicked = false;
    for (const sel of nextSelectors) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible().catch(() => false)) {
        const disabled = await loc.getAttribute('aria-disabled');
        if (disabled === 'true') break;
        await loc.click().catch(() => {});
        clicked = true;
        await sleep(2000);
        break;
      }
    }
    if (!clicked) break;
    for (let s = 0; s < 12; s++) {
      mergeBatch(await page.evaluate(extractFromPage));
      await page.mouse.wheel(0, 2200);
      await sleep(PAUSE_MS);
    }
    process.stdout.write(`\rPage ${p + 2}… ${byId.size} order link(s) total`);
  }
  console.log('');

  await page.close();

  const all = [...byId.values()];
  const kept = [];
  let skippedOld = 0;
  let noDate = 0;

  for (const r of all) {
    const { keep, reason, parsed } = rowPassesYearFilter(r.snippet);
    if (!keep) {
      skippedOld++;
      continue;
    }
    if (reason === 'no_date') noDate++;
    kept.push({
      orderId: r.orderId,
      dateGuess: parsed ? parsed.raw : '',
      yearGuess: parsed ? String(parsed.y) : '',
      snippet: r.snippet,
      link: r.href,
    });
  }

  const headers = ['orderId', 'dateGuess', 'yearGuess', 'snippet', 'link'];
  const lines = [headers.join('\t')];
  for (const r of kept) {
    lines.push(
      [r.orderId, r.dateGuess, r.yearGuess, tsvEscape(r.snippet), r.link].map(tsvEscape).join('\t')
    );
  }
  const tsv = lines.join('\n');

  const outDir = resolve(__dirname, 'output');
  mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, 'ebay-orders-paste.tsv');
  writeFileSync(outFile, tsv, 'utf8');

  await clipboardy.write(tsv);

  console.log('\n---');
  console.log(`Orders with links found: ${all.length}`);
  console.log(`Rows from ${FROM_YEAR}+ (or undated): ${kept.length}`);
  console.log(`Skipped (date before ${FROM_YEAR}): ${skippedOld}`);
  console.log(`Included without a parsed DD.MM.YYYY date: ${noDate}`);
  console.log(`Saved: ${outFile}`);
  console.log('TSV copied to clipboard — open Google Sheets, click A1, paste (Ctrl+V).');
  console.log('---\n');

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
