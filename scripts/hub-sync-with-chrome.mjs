/**
 * Start Chrome (your default profile) then run incremental Seller Hub sync.
 *
 *   npm run ebay:hub-sync:chrome
 */
import { spawn } from 'node:child_process';
import { ensureChromeCdp } from './chrome-cdp.mjs';

function log(msg) {
  console.log(`[hub-sync] ${msg}`);
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
