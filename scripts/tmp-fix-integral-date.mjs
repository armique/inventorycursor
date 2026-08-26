import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('localhost:5173'));
if (!page) { console.log('no page'); process.exit(1); }

const result = await page.evaluate(() => {
  const key = 'inventory_items';
  const items = JSON.parse(localStorage.getItem(key) || '[]');
  const idx = items.findIndex((i) => i.id === 'imp-1770932245741-1');
  if (idx < 0) return { ok: false, error: 'not found' };
  const before = items[idx].sellDate;
  items[idx] = { ...items[idx], sellDate: '2025-02-27', containerSoldDate: undefined };
  localStorage.setItem(key, JSON.stringify(items));
  // nudge React if a custom event exists
  window.dispatchEvent(new Event('storage'));
  return { ok: true, before, after: items[idx].sellDate, name: items[idx].name };
});
console.log(JSON.stringify(result, null, 2));

// Prefer live app update path if available
const live = await page.evaluate(async () => {
  const w = window;
  // If React state owns inventory, localStorage alone may be overwritten — try navigating to force hydrate notice
  return {
    hasDev: Boolean(w.__inventoryDev),
    href: location.href,
  };
});
console.log(JSON.stringify(live));
await browser.close();
