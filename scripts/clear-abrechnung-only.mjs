/**
 * Hard-wipe Abrechnung (IndexedDB + cleared marker + Firebase cloud when signed in).
 * Run: node scripts/clear-abrechnung-only.mjs
 */
import { chromium } from 'playwright';

const APP = process.env.INVENTORY_APP_URL || 'http://localhost:5173/panel/ebay-abrechnung';

async function clearInPage(page) {
  return page.evaluate(async () => {
    try {
      const mod = await import('/services/ebayTransactionReportSync.ts');
      await mod.clearEbayTransactionReportsEverywhere();
      return { ok: true, clearedAt: localStorage.getItem('ebay_tx_reports_cleared_at') || '' };
    } catch (err) {
      const DB = 'inventory-pro-ebay-tx-report';
      const STORE = 'report';
      const KEYS = ['library', 'latest', 'stats', 'labelOverrides'];
      const CLEARED_KEY = 'ebay_tx_reports_cleared_at';

      await new Promise((resolve, reject) => {
        const req = indexedDB.open(DB);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) {
            db.close();
            resolve(undefined);
            return;
          }
          const tx = db.transaction(STORE, 'readwrite');
          const store = tx.objectStore(STORE);
          for (const key of KEYS) store.delete(key);
          tx.oncomplete = () => {
            db.close();
            resolve(undefined);
          };
          tx.onerror = () => reject(tx.error);
        };
      });

      localStorage.setItem(CLEARED_KEY, new Date().toISOString());
      return {
        ok: true,
        fallback: true,
        error: err instanceof Error ? err.message : String(err),
        clearedAt: localStorage.getItem(CLEARED_KEY) || '',
      };
    }
  });
}

async function main() {
  let browser;
  try {
    browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  } catch {
    browser = await chromium.launch({ headless: false });
  }
  const ctx = browser.contexts()[0] || (await browser.newContext());
  let page = ctx.pages().find((p) => /5173|localhost/.test(p.url()));
  if (!page) page = await ctx.newPage();

  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);

  const result = await clearInPage(page);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const snap = await page.evaluate(() => ({
    hasCoverage: /ALREADY IMPORTED|Already imported/i.test(document.body.innerText),
    hasDropZone: /Drop the Transaktionsbericht CSV|Add CSV/i.test(document.body.innerText),
    hasBestellungCount: (document.body.innerText.match(/\d+\s+Bestellung/gi) || []).slice(0, 3),
    preview: document.body.innerText.slice(0, 600).replace(/\s+/g, ' '),
  }));

  console.log(JSON.stringify({ result, snap }, null, 2));
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
