/**
 * Raw-CDP variant of bench-search-live.mjs: talks directly to the page target websocket
 * (bypasses the browser-level handshake, which can wedge when Chrome is busy).
 * Types "gtx 1080" into the inventory search box with the same keyDown/char/keyUp sequence
 * Playwright uses and reports long tasks + input event timings. Run: node scripts/bench-search-live-raw.mjs [label]
 */
const LABEL = process.argv[2] || 'after';
const PORT = process.argv[3] || '5173';
const RELOAD = process.argv.includes('--reload');
const QUERY = 'gtx 1080';

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const target = list.find((t) => t.type === 'page' && t.url.startsWith(`http://localhost:${PORT}`));
if (!target) {
  console.error('No localhost:5173 page target found');
  process.exit(2);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) reject(new Error(m.error.message));
    else resolve(m.result);
  }
};
function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout: ${method}`));
      }
    }, 20000);
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception || {}));
  return r.result?.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Runtime.enable');

if (RELOAD) {
  await send('Page.enable');
  await send('Page.reload', { ignoreCache: false });
  // Wait until the search input exists (app booted + signed in).
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    try {
      const has = await evaluate(`Boolean(document.querySelector('input[placeholder*="Search name"]'))`);
      if (has) break;
    } catch {}
  }
  await sleep(3000);
}

const dataset = await evaluate(`(() => {
  const raw = localStorage.getItem('inventory_items') || '[]';
  let n = 0, c = 0;
  try { const a = JSON.parse(raw); n = a.length; c = a.filter(i => i.isPC || i.isBundle).length; } catch {}
  return { itemCount: n, containerCount: c, itemsJsonChars: raw.length };
})()`);

// Foreground the tab — background tabs throttle rendering and skew long-task numbers.
await send('Page.enable');
await send('Page.bringToFront');
await sleep(500);

// Install observers + focus and clear the search box.
const ready = await evaluate(`(() => {
  const el = document.querySelector('input[placeholder*="Search name"]');
  if (!el) return 'no-input';
  // Disconnect observers leaked by previous benchmark runs to avoid double counting.
  if (window.__benchObs) { for (const o of window.__benchObs) { try { o.disconnect(); } catch {} } }
  window.__benchObs = [];
  window.__bench = { longTasks: [], events: [] };
  try {
    const o1 = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__bench.longTasks.push(Math.round(e.duration));
    });
    o1.observe({ type: 'longtask', buffered: false });
    window.__benchObs.push(o1);
  } catch {}
  try {
    const o2 = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.name === 'keydown' || e.name === 'input') {
          window.__bench.events.push({ name: e.name, duration: Math.round(e.duration), processing: Math.round(e.processingEnd - e.processingStart) });
        }
      }
    });
    o2.observe({ type: 'event', durationThreshold: 16, buffered: false });
    window.__benchObs.push(o2);
  } catch {}
  el.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, '');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`);
if (ready !== 'ok') {
  console.error('RESULT_JSON=' + JSON.stringify({ label: LABEL, error: ready }));
  process.exit(2);
}
await sleep(800);

const t0 = Date.now();
for (const ch of QUERY) {
  const key = ch === ' ' ? ' ' : ch;
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, text: ch });
  await send('Input.dispatchKeyEvent', { type: 'char', key, text: ch });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key });
  await sleep(150);
}
await sleep(1200);
const typedMs = Date.now() - t0;

const metrics = await evaluate('window.__bench');
// Restore the box.
await evaluate(`(() => {
  const el = document.querySelector('input[placeholder*="Search name"]');
  if (!el) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, '');
  el.dispatchEvent(new Event('input', { bubbles: true }));
})()`);

const longTaskTotal = metrics.longTasks.reduce((a, b) => a + b, 0);
console.log('RESULT_JSON=' + JSON.stringify({
  label: LABEL,
  dataset,
  query: QUERY,
  keystrokes: QUERY.length,
  typedWallMs: typedMs,
  longTasks: metrics.longTasks,
  longTaskCount: metrics.longTasks.length,
  longTaskTotalMs: longTaskTotal,
  worstLongTaskMs: metrics.longTasks.length ? Math.max(...metrics.longTasks) : 0,
  slowEventTimings: metrics.events,
}));
ws.close();
