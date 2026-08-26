/**
 * Dev-only: write merged Abrechnung backup CSV to data/ebay-abrechnung - backup/.
 * POST { csv, fileName?, rowCount?, coverage? }
 * Normally overwrites the single backup file in that folder.
 */
import { existsSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from 'fs';
import { dirname, resolve, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = resolve(__dirname, '..', 'data', 'ebay-abrechnung - backup');
const BACKUP_FILE = 'ebay-abrechnung-backup.csv';

/** Excel/OneDrive on Windows can hold this exact file open (documented in vite.config.ts). */
function isLockError(err) {
  return Boolean(err) && (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const csv = typeof body.csv === 'string' ? body.csv : '';
  const fileName =
    typeof body.fileName === 'string' && body.fileName.trim()
      ? body.fileName.trim()
      : BACKUP_FILE;

  if (!csv || fileName !== BACKUP_FILE) {
    res.status(400).json({ error: `csv and fileName=${BACKUP_FILE} required` });
    return;
  }

  try {
    mkdirSync(BACKUP_DIR, { recursive: true });
  } catch (err) {
    res.status(500).json({ error: `Could not create backup folder: ${err.message || err}` });
    return;
  }

  const backupPath = resolve(BACKUP_DIR, BACKUP_FILE);
  const tmpPath = resolve(BACKUP_DIR, `.${BACKUP_FILE}.tmp-${Date.now()}`);
  let finalPath = backupPath;

  try {
    // Write to a scratch file first, then swap it in — a failed write never corrupts
    // the last good backup, and the swap step is where a locked target file shows up.
    writeFileSync(tmpPath, csv, 'utf8');
    try {
      renameSync(tmpPath, backupPath);
    } catch (renameErr) {
      if (!isLockError(renameErr)) throw renameErr;
      // Target is open elsewhere (Excel, OneDrive sync, …) — save under a timestamped
      // name instead of losing this backup entirely.
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      finalPath = resolve(BACKUP_DIR, `ebay-abrechnung-backup-${stamp}.csv`);
      renameSync(tmpPath, finalPath);
    }
  } catch (err) {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      /* best-effort cleanup */
    }
    const locked = isLockError(err);
    res.status(500).json({
      error: locked
        ? `"${BACKUP_FILE}" is open in another program (Excel, OneDrive sync, …) — close it and try again. (${err.code})`
        : `${err.code ? `${err.code}: ` : ''}${err.message || String(err)}`,
    });
    return;
  }

  res.status(200).json({
    ok: true,
    fileName: finalPath === backupPath ? BACKUP_FILE : basename(finalPath),
    renamed: finalPath !== backupPath,
    backupPath: existsSync(finalPath) ? finalPath : null,
    rowCount: body.rowCount ?? null,
    coverage: body.coverage ?? null,
    bytes: Buffer.byteLength(csv, 'utf8'),
  });
}
