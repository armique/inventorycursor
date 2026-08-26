/**
 * Dev-only: save matcher suggestion table CSV to data/ebay-abrechnung - backup/.
 * POST { csv, rowCount? }
 */
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = resolve(__dirname, '..', 'data', 'ebay-abrechnung - backup');
const MATCHER_FILE = 'ebay-abrechnung-matcher.csv';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const csv = typeof body.csv === 'string' ? body.csv : '';
  if (!csv) {
    res.status(400).json({ error: 'csv required' });
    return;
  }

  mkdirSync(BACKUP_DIR, { recursive: true });
  const backupPath = resolve(BACKUP_DIR, MATCHER_FILE);
  writeFileSync(backupPath, csv, 'utf8');

  res.status(200).json({
    ok: true,
    fileName: MATCHER_FILE,
    backupPath: existsSync(backupPath) ? backupPath : null,
    rowCount: body.rowCount ?? null,
    bytes: Buffer.byteLength(csv, 'utf8'),
  });
}
