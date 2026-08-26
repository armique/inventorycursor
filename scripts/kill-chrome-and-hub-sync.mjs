/**
 * Kill Chrome, wait for CDP launch via hub-sync-with-chrome.
 * Use when normal Chrome was open without the debug port.
 *
 *   node scripts/kill-chrome-and-hub-sync.mjs
 */
import { spawn, execSync } from 'node:child_process';
import { ensureChromeCdp } from './chrome-cdp.mjs';

function log(msg) {
  console.log(`[hub-sync] ${msg}`);
}

function chromeCount() {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq chrome.exe" /NH', { encoding: 'utf8' });
    return (out.match(/chrome\.exe/gi) || []).length;
  } catch {
    return 0;
  }
}

function killChrome() {
  try {
    execSync('taskkill /F /IM chrome.exe /T', { stdio: 'ignore' });
  } catch {
    /* already closed */
  }
}

let n = chromeCount();
if (n > 0) {
  log(`Closing ${n} Chrome process(es)…`);
  killChrome();
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    n = chromeCount();
    if (n === 0) break;
  }
  if (n > 0) {
    log(`Warning: ${n} Chrome process(es) still running — sync may fail.`);
  } else {
    log('Chrome closed.');
  }
}

const chromeOk = await ensureChromeCdp({ log });
if (!chromeOk) process.exit(1);

log('Running incremental hub archive sync…');

await new Promise((resolve, reject) => {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = spawn(npmCmd, ['run', 'ebay:hub-sync'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  child.on('error', reject);
  child.on('exit', (code) => {
    if (code === 0) resolve();
    else reject(new Error(`hub sync exited with code ${code}`));
  });
});

log('Done.');
