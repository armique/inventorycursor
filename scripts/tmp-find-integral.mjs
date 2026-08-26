import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('localhost:5173'));
if (!page) { console.log('no page'); process.exit(1); }

const result = await page.evaluate(() => {
  const items = JSON.parse(localStorage.getItem('inventory_items') || '[]');
  const orderId = '06-12769-85233';
  const byOrder = items.filter((i) => (i.ebayOrderId || '').trim() === orderId);
  const integral = items.find((i) => i.id === 'imp-1770932245741-1');
  return {
    linkedToOrder: byOrder.map((i) => ({ id: i.id, name: i.name, sellDate: i.sellDate, ebayOrderId: i.ebayOrderId })),
    integral: integral && {
      id: integral.id,
      name: integral.name,
      sellDate: integral.sellDate,
      ebayOrderId: integral.ebayOrderId,
      ebayListingId: integral.ebayListingId,
      sellPrice: integral.sellPrice,
      saleProceeds: integral.saleProceeds,
      customer: integral.customer,
      ebayUsername: integral.ebayUsername,
      platformSold: integral.platformSold,
    },
  };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
