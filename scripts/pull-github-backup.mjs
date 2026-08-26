/**
 * Pull the latest GitHub backup snapshot (pushed automatically by the app, from any
 * device) down into a local file inside the project folder — a last-resort, offline
 * copy that survives even if GitHub and every device are unreachable at once.
 *
 * Runs automatically on every `Start-InventoryPro.bat` launch. Best-effort: never
 * blocks or fails the app launch — a missing token or a network hiccup just skips it.
 *
 * One-time setup: add to .env.local
 *   GITHUB_BACKUP_REPO=owner/repo
 *   GITHUB_BACKUP_TOKEN=ghp_xxx   (same PAT you used in Settings > Backup works fine)
 */
import dotenv from 'dotenv';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

dotenv.config({ path: join(ROOT, '.env.local') });
dotenv.config({ path: join(ROOT, '.env') });

const GITHUB_API = 'https://api.github.com';
const BACKUP_PATH = 'backup.json';
const OUT_DIR = join(ROOT, 'data', 'inventory-backup');
const LATEST_FILE = join(OUT_DIR, 'backup.json');
const KEEP_DAILY_COPIES = 30;

function log(msg) {
  console.log(`[pull-github-backup] ${msg}`);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function pruneOldDailyCopies() {
  let names;
  try {
    names = readdirSync(OUT_DIR);
  } catch {
    return;
  }
  const dated = names
    .filter((n) => /^backup-\d{4}-\d{2}-\d{2}\.json$/.test(n))
    .sort();
  const excess = dated.length - KEEP_DAILY_COPIES;
  if (excess <= 0) return;
  for (const name of dated.slice(0, excess)) {
    try {
      unlinkSync(join(OUT_DIR, name));
    } catch {
      /* best-effort */
    }
  }
}

async function main() {
  const repo = process.env.GITHUB_BACKUP_REPO?.trim();
  const token = process.env.GITHUB_BACKUP_TOKEN?.trim();
  if (!repo || !token) {
    log('Not configured (set GITHUB_BACKUP_REPO / GITHUB_BACKUP_TOKEN in .env.local) — skipping.');
    return;
  }

  const [owner, name] = repo.split('/').map((s) => s.trim());
  if (!owner || !name) {
    log(`GITHUB_BACKUP_REPO must be "owner/repo", got "${repo}" — skipping.`);
    return;
  }

  let res;
  try {
    res = await fetch(`${GITHUB_API}/repos/${owner}/${name}/contents/${BACKUP_PATH}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    log(`Network error — skipping (${e instanceof Error ? e.message : String(e)}).`);
    return;
  }

  if (res.status === 404) {
    log('No backup.json in the repo yet (nothing pushed from the app so far) — skipping.');
    return;
  }
  if (!res.ok) {
    log(`GitHub API error ${res.status} — skipping.`);
    return;
  }

  const data = await res.json();
  if (!data.content) {
    log('Empty response from GitHub — skipping.');
    return;
  }
  const content = Buffer.from(data.content, 'base64').toString('utf8');

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(LATEST_FILE, content, 'utf8');
  const dailyFile = join(OUT_DIR, `backup-${todayKey()}.json`);
  writeFileSync(dailyFile, content, 'utf8');
  pruneOldDailyCopies();

  const kb = Math.round(Buffer.byteLength(content, 'utf8') / 1024);
  log(`Saved local copy (${kb} KB) to data/inventory-backup/backup.json`);
}

main().catch((e) => {
  log(`Unexpected error — skipping (${e instanceof Error ? e.message : String(e)}).`);
});
