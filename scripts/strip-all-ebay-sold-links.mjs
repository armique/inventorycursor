/**
 * Apply chunked eBay sold unlink in the browser (avoids UI freeze).
 * Run: node scripts/strip-all-ebay-sold-links.mjs
 */
import { chromium } from 'playwright';

const APP = process.env.INVENTORY_APP_URL || 'http://localhost:5173/panel/ebay-abrechnung';

async function main() {
  let browser;
  try {
    browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  } catch {
    browser = await chromium.launch({ headless: false });
  }
  const ctx = browser.contexts()[0] || (await browser.newContext());
  let page = ctx.pages().find((p) => /5173/.test(p.url()));
  if (!page) page = await ctx.newPage();

  page.on('dialog', (d) => d.accept());

  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.reload({ waitUntil: 'domcontentloaded' });

  const btn = page.locator('button').filter({ hasText: /Unlink all eBay sold/i });
  await btn.first().waitFor({ state: 'visible', timeout: 30000 });
  await btn.first().click();

  await page.waitForFunction(
    () => {
      const t = document.body.innerText;
      return (
        t.includes('sell cells cleared') ||
        t.includes('No eBay-linked sold') ||
        t.includes('Unlinking') ||
        t.includes('Done unlinking')
      );
    },
    { timeout: 300000 }
  );

  const note = await page.evaluate(() => {
    const ps = [...document.querySelectorAll('p')].map((p) => p.textContent?.trim() || '');
    return ps.find((t) => /unlink|cleared|No eBay/i.test(t)) || ps.slice(-3).join(' | ');
  });
  console.log(JSON.stringify({ note }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
