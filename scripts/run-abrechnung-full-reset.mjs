/**
 * One-shot: Full Abrechnung reset on live dev app (unlink eBay sales, wipe matcher, import CSVs, rebuild suggestions).
 * Run: node scripts/run-abrechnung-full-reset.mjs
 * Requires: dev server on http://127.0.0.1:5173 and Chrome with app open (or launches page).
 */
import { chromium } from 'playwright';

const APP = 'http://127.0.0.1:5173/panel/ebay-abrechnung';

async function main() {
  let browser;
  try {
    browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  } catch {
    browser = await chromium.launch({ headless: false });
  }
  const ctx = browser.contexts()[0] || (await browser.newContext());
  let page = ctx.pages().find((p) => p.url().includes('127.0.0.1:5173') || p.url().includes('localhost:5173'));
  if (!page) page = await ctx.newPage();

  page.on('dialog', (d) => d.accept());

  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.body.innerText.includes('eBay Abrechnung') && !document.body.innerText.includes('Loading eBay report'),
    { timeout: 60000 }
  );

  const api = await page.evaluate(async () => {
    const res = await fetch('/api/ebay-abrechnung-csvs');
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, ...(await res.json()) };
  });
  console.log('API CSV list:', api);

  const btn = page.locator('button').filter({ hasText: /Full reset/i });
  await btn.first().waitFor({ state: 'visible', timeout: 30000 });

  await btn.click();
  await page.waitForFunction(
    () => {
      const t = document.body.innerText;
      return t.includes('Reset complete') || t.includes('Full reset failed') || t.includes('Could not read data/ebay-abrechnung');
    },
    { timeout: 180000 }
  );

  const result = await page.evaluate(() => ({
    note: [...document.querySelectorAll('p')].map((p) => p.textContent?.trim()).filter((t) => t?.includes('Reset complete') || t?.includes('failed') || t?.includes('Could not')),
    hasSuggestions: document.body.innerText.includes('Suggested matches'),
    coverage: document.body.innerText.match(/ALREADY IMPORTED[\s\S]{0,80}/)?.[0] || '',
  }));
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
