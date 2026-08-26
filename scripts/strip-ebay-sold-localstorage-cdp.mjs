/**
 * Strip all eBay order fields from sold items directly in localStorage (no React hooks).
 * Run: node scripts/strip-ebay-sold-localstorage-cdp.mjs
 */
import WebSocket from 'ws';

const CDP = 'http://127.0.0.1:9222';

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
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result?.value;
}

async function connect() {
  const pages = await cdpGet('/json/list');
  const target = pages.find((p) => /5173|localhost/.test(p.url || ''));
  if (!target?.webSocketDebuggerUrl) throw new Error('Open http://localhost:5173 in Chrome (port 9222)');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  await cdpSend(ws, 'Runtime.enable');
  return ws;
}

const STRIP_EVAL = `(async () => {
  const {
    bulkStripAllEbaySoldLinks,
    countItemsWithEbayOrderData,
    planSoldItemEbayOrderFieldScrub,
  } = await import('/utils/bulkStripEbayAbrechnungLinks.ts');

  let items = JSON.parse(localStorage.getItem('inventory_items') || '[]');
  const before = countItemsWithEbayOrderData(items);
  let totalPatches = 0;

  for (let pass = 0; pass < 4; pass++) {
    const result = bulkStripAllEbaySoldLinks(items);
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const id of result.deleteIds) byId.delete(id);
    for (const patch of result.updates) byId.set(patch.id, patch);
    items = [...byId.values()];
    totalPatches += result.updates.length;

    const scrub = planSoldItemEbayOrderFieldScrub(items);
    for (const patch of scrub) {
      const byId2 = new Map(items.map((i) => [i.id, i]));
      byId2.set(patch.id, patch);
      items = [...byId2.values()];
      totalPatches += 1;
    }
  }

  localStorage.setItem('inventory_items', JSON.stringify(items));
  localStorage.setItem('inventory_ebay_unlink_at', new Date().toISOString());
  const after = countItemsWithEbayOrderData(items);
  return { before, after, totalPatches, itemCount: items.length };
})()`;

async function main() {
  const ws = await connect();
  await cdpSend(ws, 'Page.navigate', { url: 'http://localhost:5173/panel/inventory' });
  await new Promise((r) => setTimeout(r, 4000));

  const stripped = await evalAwait(ws, STRIP_EVAL);
  console.log('STRIPPED', JSON.stringify(stripped, null, 2));

  if ((stripped?.after?.soldWithAnyOrderData || 0) > 0) {
    ws.close();
    process.exitCode = 2;
    console.error('Still have sold items with eBay order data after strip');
    return;
  }

  // Reload so React picks up localStorage; then re-check before cloud can stomp.
  await cdpSend(ws, 'Page.reload', { ignoreCache: true });
  await new Promise((r) => setTimeout(r, 8000));

  const verify = await evalAwait(
    ws,
    `(async () => {
      const { countItemsWithEbayOrderData } = await import('/utils/bulkStripEbayAbrechnungLinks.ts');
      const items = JSON.parse(localStorage.getItem('inventory_items') || '[]');
      return countItemsWithEbayOrderData(items);
    })()`
  );
  console.log('VERIFY', JSON.stringify(verify, null, 2));

  if ((verify?.soldWithAnyOrderData || 0) > 0) {
    process.exitCode = 2;
    console.error('After reload: sold items still have eBay order data (cloud may have restored — run again)');
  } else {
    console.log('OK: sold items have no eBay order links');
  }

  ws.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
