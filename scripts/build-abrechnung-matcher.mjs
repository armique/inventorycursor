/**
 * Import bundled CSVs (if needed), build suggested matches, optionally apply high-confidence links.
 * Run: node scripts/build-abrechnung-matcher.mjs
 * Optional: APPLY=1 node scripts/build-abrechnung-matcher.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const APP = process.env.INVENTORY_APP_URL || 'http://localhost:5173/panel/ebay-abrechnung';
const APPLY = process.env.APPLY === '1' || process.env.APPLY === 'true';
const CSV_DIR = path.join(process.cwd(), 'data', 'ebay-abrechnung');

function listOfficialCsvPaths() {
  if (!fs.existsSync(CSV_DIR)) return [];
  return fs
    .readdirSync(CSV_DIR)
    .filter((name) => name.toLowerCase().endsWith('.csv'))
    .filter((name) => /Transaktionsbericht|Datum der Transaktionserstellung|Bestellnummer/i.test(
      fs.readFileSync(path.join(CSV_DIR, name), 'utf8')
    ) || /^Transaction-/i.test(name))
    .map((name) => path.join(CSV_DIR, name))
    .sort();
}

async function waitForAppReady(page) {
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(
    () =>
      document.body.innerText.includes('eBay Abrechnung') &&
      !document.body.innerText.includes('Loading eBay report'),
    { timeout: 90000 }
  );
}

async function readCsvState(page) {
  return page.evaluate(() => {
    const text = document.body.innerText;
    const orderTab = text.match(/(\d+)\s+Bestellung/i)?.[1] || null;
    const hasCoverage = /Already imported|ALREADY IMPORTED/i.test(text);
    const hasRows = /Verkaufserlös|In pocket|All \d+/i.test(text);
    const hasDropOnly = /Drop the Transaktionsbericht CSV/i.test(text) && !orderTab;
    return {
      orderCount: orderTab ? Number(orderTab) : 0,
      hasCoverage,
      hasRows,
      hasDropOnly,
    };
  });
}

async function importCsvs(page, files) {
  if (!files.length) throw new Error(`No official CSV files in ${CSV_DIR}`);
  const input = page.locator('input[type="file"][accept*="csv"]');
  await input.setInputFiles(files);
  await page.waitForFunction(
    () => {
      const t = document.body.innerText;
      return (
        /Already imported|ALREADY IMPORTED/i.test(t) ||
        /\d+\s+Bestellung/i.test(t) ||
        /Could not read|not an eBay Transaktionsbericht/i.test(t)
      );
    },
    { timeout: 180000 }
  );
  await page.waitForTimeout(2000);
}

async function buildMatcher(page) {
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      /^Suggested matches$/i.test((b.textContent || '').trim())
    );
    btn?.click();
  });
  await page.waitForFunction(
    () =>
      document.body.innerText.includes('Suggested matches:') ||
      document.body.innerText.includes('Import CSV files first'),
    { timeout: 300000 }
  );
  return page.evaluate(() => {
    const text = document.body.innerText;
    const note =
      [...document.querySelectorAll('p')].map((p) => p.textContent?.trim()).find((t) => t?.includes('Suggested matches:')) ||
      '';
    const m = note.match(/Suggested matches:\s*(\d+)\s+orders\s*·\s*(\d+)\s+high\s*·\s*(\d+)\s+medium\s*·\s*(\d+)\s+already linked/i);
    return {
      note,
      orders: m ? Number(m[1]) : null,
      high: m ? Number(m[2]) : null,
      medium: m ? Number(m[3]) : null,
      linked: m ? Number(m[4]) : null,
      tableRows: document.querySelectorAll('table tbody tr').length,
      hasPanel: text.includes('Suggested matches'),
    };
  });
}

async function applyHighConfidence(page) {
  const applyBtn = page.locator('button').filter({ hasText: /^Apply high confidence$/i });
  if (!(await applyBtn.count())) return { applied: false, note: 'No apply button' };
  await applyBtn.first().click();
  await page.waitForTimeout(8000);
  const note = await page.evaluate(() =>
    [...document.querySelectorAll('p')]
      .map((p) => p.textContent?.trim())
      .find((t) => t?.includes('Linked ') || t?.includes('No high-confidence') || t?.includes('high-confidence')) || ''
  );
  return { applied: true, note };
}

async function main() {
  const csvFiles = listOfficialCsvPaths();
  console.log('CSV files:', csvFiles.map((p) => path.basename(p)));

  let browser;
  try {
    browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 15000 });
  } catch (err) {
    throw new Error(
      `Chrome CDP on :9222 required (open app at ${APP}). ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const ctx = browser.contexts()[0] || (await browser.newContext());
  let page = ctx.pages().find((p) => /5173|localhost/.test(p.url()));
  if (!page) page = await ctx.newPage();
  page.on('dialog', (d) => void d.accept().catch(() => undefined));

  await waitForAppReady(page);
  let state = await readCsvState(page);
  console.log('Initial state:', state);

  if (state.orderCount < 10 && csvFiles.length) {
    console.log('Importing CSVs…');
    await importCsvs(page, csvFiles);
    state = await readCsvState(page);
    console.log('After import:', state);
  }

  if (state.orderCount < 10 && !state.hasRows) {
    throw new Error('Abrechnung has no CSV orders — sign in on localhost:5173 and import, or place CSVs in data/ebay-abrechnung');
  }

  console.log('Building matcher…');
  const built = await buildMatcher(page);
  console.log('Matcher:', JSON.stringify(built, null, 2));

  if (APPLY && built.high > 0) {
    console.log('Applying high-confidence links…');
    const applied = await applyHighConfidence(page);
    console.log('Apply:', JSON.stringify(applied, null, 2));
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
