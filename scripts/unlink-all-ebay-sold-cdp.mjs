/**
 * Unlink all eBay order data from sold inventory via the live Abrechnung page hook.
 * Run: node scripts/unlink-all-ebay-sold-cdp.mjs
 */
import WebSocket from 'ws';

const CDP = 'http://127.0.0.1:9222';
const APP = 'http://localhost:5173/panel/ebay-abrechnung';

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

async function evalAwait(ws, expression) {
  const result = await cdpSend(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
  }
  return result.result?.value;
}

async function main() {
  const pages = await cdpGet('/json/list');
  let target =
    pages.find((p) => /5173|localhost/.test(p.url || '') && /ebay-abrechnung/i.test(p.url || '')) ||
    pages.find((p) => /5173|localhost/.test(p.url || ''));
  if (!target?.webSocketDebuggerUrl) {
    throw new Error('Open Chrome on localhost:5173 with debug port 9222.');
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  await cdpSend(ws, 'Runtime.enable');
  await cdpSend(ws, 'Page.navigate', { url: 'http://localhost:5173/panel/inventory' });
  await evalAwait(
    ws,
    `(async () => {
      for (let i = 0; i < 120; i++) {
        if (window.__inventoryDev && typeof window.__unlinkAllEbaySold === 'function') return true;
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error('Reload app — latest dev hooks not loaded');
    })()`
  );
  await cdpSend(ws, 'Page.navigate', { url: APP });
  await evalAwait(
    ws,
    `(async () => {
      for (let i = 0; i < 60; i++) {
        if (typeof window.__unlinkAllEbaySold === 'function') return true;
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error('Abrechnung hook not ready');
    })()`
  );

  const before = await evalAwait(ws, `window.__countEbayOrderLinks()`);
  console.log('BEFORE', JSON.stringify(before, null, 2));

  const result = await evalAwait(ws, `(async () => window.__unlinkAllEbaySold())()`);
  console.log('UNLINK', JSON.stringify(result, null, 2));

  // Wait for debounced localStorage + cloud flush (unlink does 2 passes + flushCloudNow).
  await new Promise((r) => setTimeout(r, 20000));

  const after = await evalAwait(
    ws,
    `(async () => {
      const { countItemsWithEbayOrderData } = await import('/utils/bulkStripEbayAbrechnungLinks.ts');
      const fromStorage = JSON.parse(localStorage.getItem('inventory_items') || '[]');
      return {
        storage: countItemsWithEbayOrderData(fromStorage),
        hook: typeof window.__countEbayOrderLinks === 'function' ? window.__countEbayOrderLinks() : null,
      };
    })()`
  );
  console.log('AFTER', JSON.stringify(after, null, 2));

  const left = after?.storage?.soldWithAnyOrderData ?? after?.storage?.withOrderId ?? 999;
  if (left > 0) {
    ws.close();
    process.exitCode = 2;
    console.error(`FAILED: ${left} sold item(s) still carry eBay order data`);
    return;
  }

  console.log('OK: sold items no longer have eBay order links');
  ws.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
