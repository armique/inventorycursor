/**
 * Start a dedicated Chrome (CDP port 9222) so Seller Hub auto-read works,
 * then run `npm run dev` unless Vite is already up.
 *
 *   npm run dev:ebay
 *   npm run chrome:cdp
 *
 * Uses a separate Chrome profile, so you do not have to quit your normal Chrome.
 * First time: log into eBay.de in the window that opens, then keep that window.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { EBAY_SELLER_HUB_ORDERS_URL } from '../lib/ebaySellerHubPayout.js';

const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const VITE_PORT = Number(process.env.VITE_PORT || 5173);
const CDP_URL = process.env.CDP_URL || `http://127.0.0.1:${CDP_PORT}`;
const chromeOnly = process.argv.includes('--chrome-only');

function log(msg) {
  console.log(`[ebay-dev] ${msg}`);
}

function findBrowser() {
  const home = homedir();
  const local = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
  const pf = process.env.PROGRAMFILES || 'C:\\Program Files';
  const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const candidates = [
    join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
  return candidates.find((p) => existsSync(p)) || null;
}

function profileDir() {
  const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  return join(local, 'inventory-pro-chrome-cdp');
}

async function isHttpOk(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(900) });
    return res.ok;
  } catch {
    return false;
  }
}

async function cdpReady() {
  return isHttpOk(`${CDP_URL}/json/version`);
}

async function viteReady() {
  return isHttpOk(`http://127.0.0.1:${VITE_PORT}`);
}

async function waitFor(check, label, ms = 15000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  log(`Timed out waiting for ${label}.`);
  return false;
}

async function launchChrome() {
  if (await cdpReady()) {
    log(`Chrome debug already running on port ${CDP_PORT}.`);
    return true;
  }
  const browser = findBrowser();
  if (!browser) {
    log('Could not find Chrome or Edge. Install Chrome, then run npm run dev:ebay again.');
    return false;
  }
  const dir = profileDir();
  mkdirSync(dir, { recursive: true });
  log(`Starting ${browser.includes('msedge') ? 'Edge' : 'Chrome'} with debug port ${CDP_PORT}`);
  log(`Profile (keep this window for eBay login): ${dir}`);
  const child = spawn(
    browser,
    [
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${dir}`,
      '--no-first-run',
      '--no-default-browser-check',
      EBAY_SELLER_HUB_ORDERS_URL,
    ],
    {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    }
  );
  child.unref();
  const ok = await waitFor(cdpReady, `Chrome debug :${CDP_PORT}`);
  if (!ok) {
    log('Chrome opened but debug port did not come up. Close other debug Chromes and retry.');
    return false;
  }
  log('Chrome debug is ready. Log into eBay.de in that window if asked.');
  return true;
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

const chromeOk = await launchChrome();
if (chromeOnly) {
  if (!chromeOk) process.exit(1);
  log('Done. Leave this Chrome window open and logged into eBay.de, then click Bind · sold.');
  process.exit(0);
}

if (await viteReady()) {
  log(`Vite already running at http://localhost:${VITE_PORT}`);
  log('Open Mark as sold → Bind · sold (reads Seller Hub in this Chrome).');
  process.exit(0);
}

startVite();
