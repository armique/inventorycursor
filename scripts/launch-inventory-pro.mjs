/**
 * One double-click launcher — no npm commands, no terminal window.
 *
 * Desktop shortcut: "Inventory Pro"  (Start-InventoryPro.vbs)
 */
import { spawn, execSync } from 'node:child_process';
import { existsSync, openSync, appendFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PREFERRED_PORT = Number(process.env.VITE_PORT || 5173);
const HOST = process.env.INVENTORY_HOST || 'localhost';
const LOG_FILE =
  process.env.INVENTORY_PRO_LAUNCHER_LOG ||
  join(process.env.LOCALAPPDATA || ROOT, 'inventory-pro-launcher.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    appendFileSync(LOG_FILE, line);
  } catch {
    /* ignore */
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function isPortUp(port) {
  for (const host of [HOST, '127.0.0.1', '[::1]']) {
    try {
      const res = await fetch(`http://${host}:${port}/`, { signal: AbortSignal.timeout(1500) });
      if (res.status > 0) return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

/** Vite dev can get stuck serving empty Tailwind CSS after HMR/cache corruption. */
async function isViteCssHealthy(port) {
  for (const host of [HOST, '127.0.0.1', '[::1]']) {
    try {
      const res = await fetch(`http://${host}:${port}/index.css?health=${Date.now()}`, {
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) continue;
      const text = await res.text();
      if (text.includes('const __vite__css = ""')) return false;
      if (text.includes('.bg-slate-50') || text.includes('tailwind') || text.length > 20_000) return true;
      return false;
    } catch {
      /* try next host */
    }
  }
  return false;
}

function clearViteCache() {
  const cacheDir = join(ROOT, 'node_modules', '.vite');
  if (!existsSync(cacheDir)) return;
  try {
    rmSync(cacheDir, { recursive: true, force: true });
    log('Cleared Vite cache (node_modules/.vite).');
  } catch (e) {
    log(`Could not clear Vite cache: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function killProcessOnPort(port) {
  if (process.platform !== 'win32') return;
  try {
    const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
    const pids = new Set(
      out
        .split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/).pop())
        .filter((pid) => pid && /^\d+$/.test(pid))
    );
    for (const pid of pids) {
      try {
        execSync(`taskkill /F /PID ${pid} /T`, { stdio: 'ignore' });
        log(`Stopped pid ${pid} on port ${port}.`);
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* nothing listening */
  }
}

async function stopUnhealthyVite(port) {
  log(`Unhealthy Vite on port ${port} — stopping and clearing cache.`);
  killProcessOnPort(port);
  clearViteCache();
  await sleep(800);
}

async function findRunningVitePort() {
  for (let port = PREFERRED_PORT; port <= PREFERRED_PORT + 8; port++) {
    if (await isPortUp(port)) return port;
  }
  return null;
}

function startViteHidden(port) {
  const viteBin = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(viteBin)) {
    throw new Error('Run npm install once in the project folder (first-time setup).');
  }

  log(`Starting Vite on port ${port} (hidden)…`);
  let logFd;
  try {
    logFd = openSync(LOG_FILE, 'a');
  } catch {
    logFd = 'ignore';
  }

  const child = spawn(process.execPath, [viteBin, '--port', String(port), '--strictPort', '--host', HOST], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
    env: { ...process.env, VITE_PORT: String(port) },
  });
  child.unref();
  log(`Vite pid ${child.pid ?? 'unknown'}`);
}

async function waitForPort(port, ms = 60000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await isPortUp(port)) return true;
    await sleep(400);
  }
  return false;
}

async function ensureAppServerPort() {
  const existing = await findRunningVitePort();
  if (existing) {
    if (await isViteCssHealthy(existing)) {
      log(`Reusing healthy app server on port ${existing}.`);
      return existing;
    }
    await stopUnhealthyVite(existing);
  }

  startViteHidden(PREFERRED_PORT);
  const ok = await waitForPort(PREFERRED_PORT);
  if (ok) {
    if (await isViteCssHealthy(PREFERRED_PORT)) return PREFERRED_PORT;
    log('Fresh Vite started but CSS still empty — clearing cache once more.');
    await stopUnhealthyVite(PREFERRED_PORT);
    startViteHidden(PREFERRED_PORT);
    if ((await waitForPort(PREFERRED_PORT)) && (await isViteCssHealthy(PREFERRED_PORT))) {
      return PREFERRED_PORT;
    }
  }

  const fallback = await findRunningVitePort();
  if (fallback && (await isViteCssHealthy(fallback))) {
    log(`App server came up on port ${fallback} instead.`);
    return fallback;
  }

  throw new Error('App server did not start with valid CSS. See inventory-pro-launcher.log in AppData\\Local.');
}

function openInDefaultBrowser(url) {
  log(`Opening default browser: ${url}`);
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (e) {
    log(`Could not open browser automatically: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function showError(message) {
  log(`ERROR: ${message}`);
  if (process.platform !== 'win32') return;
  const safe = message.replace(/'/g, "''").replace(/\r?\n/g, ' ');
  try {
    execSync(
      `powershell -NoProfile -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${safe}', 'Inventory Pro', 'OK', 'Warning')"`,
      { stdio: 'ignore' }
    );
  } catch {
    /* headless */
  }
}

/** Best-effort, non-blocking: refresh the local backup.json copy from GitHub in the background. */
function pullGitHubBackupInBackground() {
  let logFd;
  try {
    logFd = openSync(LOG_FILE, 'a');
  } catch {
    logFd = 'ignore';
  }
  const child = spawn(process.execPath, [join(__dirname, 'pull-github-backup.mjs')], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
  });
  child.unref();
}

async function main() {
  log('--- launch ---');
  if (!existsSync(join(ROOT, 'package.json'))) {
    throw new Error('Could not find the Inventory Pro project folder.');
  }

  pullGitHubBackupInBackground();

  const port = await ensureAppServerPort();
  const panelUrl = `http://${HOST}:${port}/panel`;
  log(`Panel URL: ${panelUrl}`);

  openInDefaultBrowser(panelUrl);

  log('Launch complete.');
}

main().catch((e) => {
  showError(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
