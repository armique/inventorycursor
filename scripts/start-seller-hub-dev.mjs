/**
 * Start Chrome with CDP (port 9222) for Seller Hub, optionally start Vite.
 *
 *   npm run chrome:cdp     → Chrome only (default: YOUR profile)
 *   npm run dev:ebay       → Chrome + Vite dev server
 *   npm run ebay:hub-sync:chrome → Chrome then incremental hub sync
 *
 * Default profile = a private, auto-refreshed copy of your normal Chrome
 * profile (bookmarks, extensions, eBay session) — runs fine alongside your
 * regular Chrome, no need to close anything.
 *
 * Old isolated sandbox (empty profile, no extensions/login):
 *   npm run chrome:cdp:isolated
 */
import { spawn } from 'node:child_process';
import { CDP_PORT, ensureChromeCdp } from './chrome-cdp.mjs';

const VITE_PORT = Number(process.env.VITE_PORT || 5173);
const chromeOnly = process.argv.includes('--chrome-only');

function log(msg) {
  console.log(`[ebay-dev] ${msg}`);
}

async function isHttpOk(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(900) });
    return res.ok;
  } catch {
    return false;
  }
}

async function viteReady() {
  return isHttpOk(`http://127.0.0.1:${VITE_PORT}`);
}

function startVite() {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  log(`Starting npm run dev  →  http://localhost:${VITE_PORT}/panel/inventory`);
  const child = spawn(npmCmd, ['run', 'dev'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

const chromeOk = await ensureChromeCdp({ log });

if (chromeOnly) {
  if (!chromeOk) process.exit(1);
  log(`Done. Hub scripts connect to http://127.0.0.1:${CDP_PORT}`);
  log('Leave this Chrome open — use it for daily browsing and eBay Seller Hub.');
  process.exit(0);
}

if (!chromeOk) process.exit(1);

if (await viteReady()) {
  log(`Vite already running at http://localhost:${VITE_PORT}`);
  log('Mark as sold → Bind · sold reads Seller Hub from this Chrome.');
  process.exit(0);
}

startVite();
