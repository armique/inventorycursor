/**
 * Build matcher inside the open dev app via Chrome CDP Runtime.evaluate (no Playwright browser install).
 * Run: node scripts/build-abrechnung-matcher-cdp.mjs
 * Optional: APPLY=1 to click Apply high confidence in the page afterward.
 */
import WebSocket from 'ws';

const CDP = 'http://127.0.0.1:9222';
const APP_MATCH = /localhost:5173|127\.0\.0\.1:5173/;
const APPLY = process.env.APPLY === '1' || process.env.APPLY === 'true';

async function cdpGet(path) {
  const res = await fetch(`${CDP}${path}`);
  if (!res.ok) throw new Error(`CDP ${path}: ${res.status}`);
  return res.json();
}

function cdpSend(ws, method, params = {}) {
  const id = Math.floor(Math.random() * 1e9);
  return new Promise((resolve, reject) => {
    const onMessage = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id !== id) return;
      ws.off('message', onMessage);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result);
    };
    ws.on('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const MATCHER_EVAL = `(async () => {
  const items = JSON.parse(localStorage.getItem('inventory_items') || '[]');
  const { loadEbayTransactionLibrary, loadEbayTxLabelOverrides } = await import('/services/ebayTransactionReportStore.ts');
  const {
    applyEbayTxLabelOverrides,
    buildEbayTxOrderLedgers,
    mergeEbayTxReports,
  } = await import('/utils/ebayTransactionReport.ts');
  const { buildEbayTxBulkMatchSuggestions } = await import('/utils/ebayTxBulkMatchSuggestions.ts');
  const lib = await loadEbayTransactionLibrary();
  const labels = await loadEbayTxLabelOverrides();
  const merged = mergeEbayTxReports(lib.reports);
  const rows = (merged?.rows || []).filter((r) => r.source !== 'inventory');
  if (!rows.length) return { error: 'No CSV rows in IndexedDB — import Transaktionsberichte first.' };
  const ledgers = applyEbayTxLabelOverrides(buildEbayTxOrderLedgers(rows), labels);
  const suggestions = buildEbayTxBulkMatchSuggestions(items, rows, ledgers);
  window.__ebayAbrechnungMatcher = suggestions;
  if (typeof window.__setEbayAbrechnungMatcher === 'function') {
    window.__setEbayAbrechnungMatcher(suggestions);
  }
  const counts = { orders: suggestions.length, high: 0, medium: 0, low: 0, linked: 0, none: 0 };
  for (const s of suggestions) counts[s.confidence] = (counts[s.confidence] || 0) + 1;
  return {
    inventoryItems: items.length,
    csvRows: rows.length,
    ...counts,
    sampleHigh: suggestions.filter((s) => s.confidence === 'high').slice(0, 5),
  };
})()`;

async function main() {
  const pages = await cdpGet('/json/list');
  let target =
    pages.find((p) => APP_MATCH.test(p.url || '') && /ebay-abrechnung/i.test(p.url || '')) ||
    pages.find((p) => APP_MATCH.test(p.url || ''));
  if (!target?.webSocketDebuggerUrl) {
    throw new Error('Open http://localhost:5173/panel/ebay-abrechnung in Chrome (debug port 9222).');
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  await cdpSend(ws, 'Runtime.enable');
  const result = await cdpSend(ws, 'Runtime.evaluate', {
    expression: MATCHER_EVAL,
    awaitPromise: true,
    returnByValue: true,
  });

  const value = result.result?.value;
  console.log(JSON.stringify(value, null, 2));

  if (value && !value.error) {
    await cdpSend(ws, 'Runtime.evaluate', {
      expression: `(async () => {
        const rows = window.__ebayAbrechnungMatcher;
        if (!rows?.length) return { saved: false };
        const { ebayTxBulkMatchSuggestionsToCsv } = await import('/utils/ebayTxBulkMatchSuggestions.ts');
        const csv = ebayTxBulkMatchSuggestionsToCsv(rows);
        const res = await fetch('/api/ebay-abrechnung-matcher-backup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ csv, rowCount: rows.length }),
        });
        if (!res.ok) return { saved: false, status: res.status };
        return await res.json();
      })()`,
      awaitPromise: true,
      returnByValue: true,
    }).then((r) => console.log('Matcher CSV:', JSON.stringify(r.result?.value, null, 2)));
  }

  if (value && !value.error && APPLY && value.high > 0) {
    await cdpSend(ws, 'Runtime.evaluate', {
      expression: `(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => /^Apply high confidence$/i.test((b.textContent || '').trim()));
        btn?.click();
        return Boolean(btn);
      })()`,
      returnByValue: true,
    });
    console.log('Clicked Apply high confidence — check the app for link progress.');
  }

  ws.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
