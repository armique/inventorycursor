/**
 * Find and scrub any remaining sold items with eBay order fields.
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

async function main() {
  const pages = await cdpGet('/json/list');
  const target = pages.find((p) => /5173|localhost/.test(p.url || ''));
  if (!target?.webSocketDebuggerUrl) throw new Error('No localhost:5173 tab');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  await cdpSend(ws, 'Runtime.enable');

  const out = await evalAwait(
    ws,
    `(async () => {
      const {
        bulkStripAllEbaySoldLinks,
        countItemsWithEbayOrderData,
        planSoldItemEbayOrderFieldScrub,
      } = await import('/utils/bulkStripEbayAbrechnungLinks.ts');
      let items = JSON.parse(localStorage.getItem('inventory_items') || '[]');
      const before = countItemsWithEbayOrderData(items);
      const leftovers = items.filter((item) => {
        const sold = item.status === 'Sold' || item.status === 'Traded';
        if (!sold) return false;
        return Boolean(
          (item.ebayOrderId || '').trim() ||
          (item.ebayUsername || '').trim() ||
          item.platformSold === 'ebay.de' ||
          item.paymentType === 'ebay.de' ||
          (item.saleProceeds && ['ebay_order','ebay_seller_hub','ebay_screenshot'].includes(item.saleProceeds.source)) ||
          (item.ebaySaleCycles || []).some((c) => (c.ebayOrderId || '').trim())
        );
      }).map((i) => ({
        id: i.id,
        name: i.name,
        status: i.status,
        ebayOrderId: i.ebayOrderId,
        ebayUsername: i.ebayUsername,
        platformSold: i.platformSold,
        paymentType: i.paymentType,
        saleProceedsSource: i.saleProceeds?.source,
      }));

      const scrub = planSoldItemEbayOrderFieldScrub(items);
      const byId = new Map(items.map((i) => [i.id, i]));
      for (const patch of scrub) byId.set(patch.id, patch);
      items = [...byId.values()];
      localStorage.setItem('inventory_items', JSON.stringify(items));

      if (typeof window.__unlinkAllEbaySold === 'function' && scrub.length) {
        await window.__unlinkAllEbaySold();
      }

      const afterStorage = countItemsWithEbayOrderData(JSON.parse(localStorage.getItem('inventory_items') || '[]'));
      return { before, leftovers, scrubCount: scrub.length, afterStorage };
    })()`
  );

  console.log(JSON.stringify(out, null, 2));
  ws.close();
  if ((out?.afterStorage?.soldWithAnyOrderData || 0) > 0) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
