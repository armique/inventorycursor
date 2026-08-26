/**
 * CPU-profiles the live app (user Chrome via CDP :9222) while typing in the inventory search box.
 * Prints top functions by self time. Run: node scripts/profile-search-live.mjs [label]
 */
import { chromium } from 'playwright';

const LABEL = process.argv[2] || 'profile';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
let page = ctx.pages().find((p) => p.url().startsWith('http://localhost:5173'));
if (!page) {
  page = await ctx.newPage();
  await page.goto('http://localhost:5173/panel/inventory', { waitUntil: 'domcontentloaded' });
}
await page.bringToFront();

const searchSel = 'input[placeholder*="Search name"]';
await page.waitForSelector(searchSel, { timeout: 20000 });
const input = page.locator(searchSel).first();
await input.click();
await input.fill('');
await page.waitForTimeout(800);

const cdp = await ctx.newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');

await input.type('gtx 1080', { delay: 150 });
await page.waitForTimeout(1000);

const { profile } = await cdp.send('Profiler.stop');
await input.fill('');

// Aggregate self time per function (sample counts × interval).
const nodesById = new Map(profile.nodes.map((n) => [n.id, n]));
const selfMicros = new Map();
const totalSamples = profile.samples?.length || 0;
const durMicros = profile.endTime - profile.startTime;
const perSample = totalSamples ? durMicros / totalSamples : 0;
for (const s of profile.samples || []) {
  selfMicros.set(s, (selfMicros.get(s) || 0) + perSample);
}
const rows = [...selfMicros.entries()]
  .map(([id, micros]) => {
    const n = nodesById.get(id);
    const f = n?.callFrame || {};
    const url = (f.url || '').split('/').slice(-2).join('/');
    return {
      fn: f.functionName || '(anonymous)',
      loc: url ? `${url}:${(f.lineNumber ?? 0) + 1}` : '',
      ms: Math.round(micros / 1000),
    };
  })
  .filter((r) => r.ms >= 20)
  .sort((a, b) => b.ms - a.ms)
  .slice(0, 40);

console.log(`label=${LABEL} profiledMs=${Math.round(durMicros / 1000)}`);
for (const r of rows) console.log(`${String(r.ms).padStart(7)}ms  ${r.fn}  ${r.loc}`);
await browser.close();
