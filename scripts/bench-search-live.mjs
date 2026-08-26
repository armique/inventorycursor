/**
 * Live search-typing benchmark against the running app in the user's Chrome (CDP :9222).
 * Measures per-keystroke long tasks, event-timing latency, and dataset size.
 * Run: node scripts/bench-search-live.mjs [label]
 * Read-only w.r.t. inventory data — only types into and clears the search box.
 */
import { chromium } from 'playwright';

const LABEL = process.argv[2] || 'baseline';
const APP_URL = 'http://localhost:5173/panel/inventory';
const QUERY = 'gtx 1080';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];

let page = ctx.pages().find((p) => p.url().startsWith('http://localhost:5173'));
if (!page) {
  page = await ctx.newPage();
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
} else {
  await page.bringToFront();
  if (!page.url().includes('/panel/inventory')) {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
}

const searchSel = 'input[placeholder*="Search name"]';
try {
  await page.waitForSelector(searchSel, { timeout: 20000 });
} catch {
  console.error('RESULT_JSON=' + JSON.stringify({ label: LABEL, error: 'search input not found (signed out or different route?)', url: page.url() }));
  process.exit(2);
}

const dataset = await page.evaluate(() => {
  const itemsRaw = localStorage.getItem('inventory_items') || '[]';
  let itemCount = 0;
  let containerCount = 0;
  try {
    const arr = JSON.parse(itemsRaw);
    itemCount = arr.length;
    containerCount = arr.filter((i) => i.isPC || i.isBundle).length;
  } catch {}
  return { itemsJsonChars: itemsRaw.length, itemCount, containerCount };
});

// Install observers before typing.
await page.evaluate(() => {
  const w = window;
  w.__bench = { longTasks: [], events: [], rowMutations: 0 };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) w.__bench.longTasks.push(Math.round(e.duration));
    }).observe({ type: 'longtask', buffered: false });
  } catch {}
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.name === 'keydown' || e.name === 'input') {
          w.__bench.events.push({ name: e.name, duration: Math.round(e.duration), processing: Math.round(e.processingEnd - e.processingStart) });
        }
      }
    }).observe({ type: 'event', durationThreshold: 16, buffered: false });
  } catch {}
  const tbody = document.querySelector('[data-inventory-table] tbody');
  if (tbody) {
    new MutationObserver((muts) => {
      w.__bench.rowMutations += muts.length;
    }).observe(tbody, { childList: true, subtree: true, attributes: true });
  }
});

const input = page.locator(searchSel).first();
await input.click();
await input.fill('');
await page.waitForTimeout(600);

// Type the query with realistic inter-key delay, then wait for settle.
const t0 = Date.now();
await input.type(QUERY, { delay: 150 });
await page.waitForTimeout(1200);
const typedMs = Date.now() - t0;

const metrics = await page.evaluate(() => window.__bench);

// Blocked time per keystroke window: sum of long tasks during typing.
const longTaskTotal = metrics.longTasks.reduce((a, b) => a + b, 0);
const worst = metrics.longTasks.length ? Math.max(...metrics.longTasks) : 0;

// Clear the box to restore state.
await input.fill('');
await page.waitForTimeout(400);

console.log('RESULT_JSON=' + JSON.stringify({
  label: LABEL,
  url: page.url(),
  dataset,
  query: QUERY,
  keystrokes: QUERY.length,
  typedWallMs: typedMs,
  longTasks: metrics.longTasks,
  longTaskCount: metrics.longTasks.length,
  longTaskTotalMs: longTaskTotal,
  worstLongTaskMs: worst,
  slowEventTimings: metrics.events,
  rowMutationRecords: metrics.rowMutations,
}));
await browser.close();
