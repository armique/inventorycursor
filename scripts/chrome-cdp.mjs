/**
 * Shared Chrome CDP launcher for Seller Hub scripts.
 *
 * Default: a private, auto-refreshed COPY of your normal Chrome profile
 * (bookmarks, extensions, eBay login) — never the live profile itself, so this
 * can run side-by-side with your regular Chrome. No need to close anything.
 *
 * Isolated sandbox profile (old behaviour, empty — no extensions/login):
 *   set USE_ISOLATED_CHROME_PROFILE=1
 *   npm run chrome:cdp
 */
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { EBAY_SELLER_HUB_ORDERS_URL } from '../lib/ebaySellerHubPayout.js';

export const CDP_PORT = Number(process.env.CDP_PORT || 9222);
export const CDP_URL = process.env.CDP_URL || `http://127.0.0.1:${CDP_PORT}`;

export function findBrowserExecutable() {
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

/** True when using the separate inventory-pro sandbox profile. */
export function useIsolatedChromeProfile(argv = process.argv) {
  if (process.env.USE_ISOLATED_CHROME_PROFILE === '1') return true;
  if (process.env.USE_MAIN_CHROME_PROFILE === '1') return false;
  if (process.env.CHROME_USE_DEFAULT_PROFILE === '1') return false;
  return argv.includes('--isolated-profile');
}

function chromeUserDataRoot() {
  const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  return join(local, 'Google', 'Chrome', 'User Data');
}

/** Which profile folder ("Default", "Profile 1", …) the user is actually using day-to-day. */
function detectLastUsedProfileFolder(userDataRoot) {
  try {
    const state = JSON.parse(readFileSync(join(userDataRoot, 'Local State'), 'utf8'));
    const last = state?.profile?.last_used;
    if (last && typeof last === 'string') return last;
  } catch {
    /* first run, or Chrome not installed under this account yet */
  }
  return 'Default';
}

const HUB_PROFILE_COPY_DIRNAME = 'inventory-pro-chrome-hub-copy';

/**
 * Old approach: a filesystem junction pointing straight at the live Chrome profile.
 * Windows resolves the junction transparently, so a second Chrome process (this one,
 * or the user's daily Chrome) can end up writing the *same physical files* at once —
 * that's what corrupted profile state and made extensions/login flaky.
 *
 * Fix: robocopy a private, disposable snapshot of the real profile instead. It never
 * shares a lock with the live profile, so it can launch anytime, even while the
 * user's normal Chrome is open, and it re-syncs (fast, incremental) on every launch
 * so extensions/cookies/login stay reasonably fresh.
 */
function syncChromeProfileCopy(log) {
  if (process.platform !== 'win32') return null;
  const userDataRoot = chromeUserDataRoot();
  if (!existsSync(userDataRoot)) return null;

  const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  const sourceProfile = detectLastUsedProfileFolder(userDataRoot);
  const src = join(userDataRoot, sourceProfile);
  const destRoot = join(local, HUB_PROFILE_COPY_DIRNAME);
  const dest = join(destRoot, 'Default');
  mkdirSync(dest, { recursive: true });

  // Cookie/saved-password values are encrypted with a key stored in Local State
  // (DPAPI-protected, tied to the Windows account, not the folder path) — copy it
  // so the copied Cookies/Login Data can still be decrypted after the copy.
  try {
    copyFileSync(join(userDataRoot, 'Local State'), join(destRoot, 'Local State'));
  } catch {
    /* locked or missing — copy below still works, just without decryptable cookies yet */
  }

  const excludeDirs = [
    'Cache', 'Cache2', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache',
    'GrShaderCache', 'ShaderCache', 'blob_storage', 'Crashpad', 'component_crx_cache',
    'Service Worker', 'IndexedDB',
  ];
  const excludeFiles = ['lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket'];

  const result = spawnSync('robocopy', [
    src, dest, '/MIR', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP',
    '/XD', ...excludeDirs.map((d) => join(src, d)),
    '/XF', ...excludeFiles,
  ], { windowsHide: true });

  // Robocopy exit codes 0-7 are success (files copied/skipped); 8+ is a real failure.
  if ((result.status ?? 0) >= 8) {
    log?.(`Profile copy had issues (robocopy exit ${result.status}) — continuing with what copied.`);
  }
  // Callers pass this as --user-data-dir and separately pass --profile-directory=Default,
  // so return the root (parent of the "Default" folder we just copied into).
  return destRoot;
}

/**
 * Hub profile dir for CDP (bookmarks/extensions/eBay session = a synced copy of
 * your normal Chrome data). Isolated sandbox (empty) when --isolated-profile.
 */
export function resolveChromeProfileDir(argv = process.argv, log) {
  const custom = process.env.CHROME_USER_DATA_DIR?.trim();
  if (custom) return custom;
  if (useIsolatedChromeProfile(argv)) {
    const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
    return join(local, 'inventory-pro-chrome-cdp');
  }
  return syncChromeProfileCopy(log) || ensureMainProfileHubDirFallback();
}

/** Non-Windows / no-robocopy fallback: junction alias (old behaviour). */
function ensureMainProfileHubDirFallback() {
  const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  const hubDir = join(local, 'inventory-pro-chrome-hub');
  const realDir = chromeUserDataRoot();
  if (existsSync(hubDir)) return hubDir;
  mkdirSync(realDir, { recursive: true });
  if (process.platform === 'win32') {
    symlinkSync(realDir, hubDir, 'junction');
  } else {
    symlinkSync(realDir, hubDir, 'dir');
  }
  return hubDir;
}

export async function isHttpOk(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(900) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function cdpReady(url = CDP_URL) {
  return isHttpOk(`${url}/json/version`);
}

export async function waitFor(check, label, ms = 15000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/**
 * Launch Chrome/Edge with CDP, or return true if already listening.
 * @param {{ log?: (msg: string) => void, startUrl?: string, argv?: string[] }} opts
 */
export async function ensureChromeCdp(opts = {}) {
  const log = opts.log || ((msg) => console.log(`[chrome-cdp] ${msg}`));
  const startUrl = opts.startUrl ?? EBAY_SELLER_HUB_ORDERS_URL;
  const argv = opts.argv || process.argv;

  if (await cdpReady()) {
    log(`Chrome debug already running on port ${CDP_PORT}.`);
    return true;
  }

  const browser = findBrowserExecutable();
  if (!browser) {
    log('Could not find Chrome or Edge. Install Google Chrome and retry.');
    return false;
  }

  const profileDir = resolveChromeProfileDir(argv, log);
  const browserName = browser.includes('msedge') ? 'Edge' : 'Chrome';

  log(`Starting ${browserName} with remote debugging on port ${CDP_PORT}`);
  mkdirSync(profileDir, { recursive: true });
  if (useIsolatedChromeProfile(argv)) {
    log(`Isolated profile: ${profileDir}`);
    log('This window will NOT have your daily bookmarks/extensions.');
  } else {
    log(`Profile: ${profileDir} (private copy of your Chrome profile — safe to run alongside your normal Chrome).`);
  }

  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profileDir}`,
    '--profile-directory=Default',
    '--no-first-run',
    '--no-default-browser-check',
    startUrl,
  ];

  const child = spawn(browser, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();

  const ok = await waitFor(cdpReady, `Chrome debug :${CDP_PORT}`, 30000);
  if (!ok) {
    log('Chrome opened but the debug port did not come up.');
    log(`Close any other debug Chrome already using port ${CDP_PORT} and retry.`);
    return false;
  }

  log(`${browserName} is ready with your extensions and eBay login. Leave this window open for Seller Hub scripts.`);
  return true;
}
