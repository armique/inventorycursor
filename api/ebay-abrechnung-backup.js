/**
 * Dev-only: local-filesystem helpers for the Abrechnung backup CSVs.
 * Consolidated into one Vercel function (Hobby plan caps at 12) — dispatched by ?route=:
 *   (default)      POST { csv, fileName?, rowCount?, coverage? } — merged backup CSV
 *   ?route=matcher POST { csv, rowCount? } — matcher suggestion table CSV
 *   ?route=csvs    GET  [?file=name.csv] — list/serve bundled Abrechnung CSVs
 * None of this runs against a real deploy (data/ is not writable/persistent on Vercel) —
 * these routes only ever get called from the local dev server (see services/ebayTxDailyExport.ts
 * `isDevServer()` gate and the standalone scripts/*-cdp.mjs tools), kept here for parity with
 * the app's `npm run dev` workflow.
 */
import { existsSync, mkdirSync, writeFileSync, renameSync, unlinkSync, readdirSync, statSync, readFileSync } from 'fs';
import { dirname, resolve, basename, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = resolve(__dirname, '..', 'data', 'ebay-abrechnung - backup');
const CSV_DIR = resolve(__dirname, '..', 'data', 'ebay-abrechnung');
const BACKUP_FILE = 'ebay-abrechnung-backup.csv';
const MATCHER_FILE = 'ebay-abrechnung-matcher.csv';

/** Mirrors utils/ebayTransactionReport.ts isEbayTransactionReportText — duplicated here so this
 *  plain-JS Vercel function doesn't need a runtime TS import. */
function isEbayTransactionReportText(text) {
  if (/inventory-pro eBay Abrechnung backup|inventory-pro-abrechnung-v1/i.test(text)) return false;
  return /Transaktionsbericht|Datum der Transaktionserstellung/i.test(text) && /Bestellnummer|Typ/i.test(text);
}

/** Excel/OneDrive on Windows can hold this exact file open (documented in vite.config.ts). */
function isLockError(err) {
  return Boolean(err) && (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES');
}

function enhanceResponse(res) {
  if (res.status) return res;
  res.status = function status(code) {
    res.statusCode = code;
    return res;
  };
  res.json = function json(data) {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    res.end(JSON.stringify(data));
  };
  return res;
}

function readJsonBody(req) {
  return req.body && typeof req.body === 'object' ? req.body : {};
}

async function handleBackup(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  const body = readJsonBody(req);
  const csv = typeof body.csv === 'string' ? body.csv : '';
  const fileName =
    typeof body.fileName === 'string' && body.fileName.trim() ? body.fileName.trim() : BACKUP_FILE;

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

async function handleMatcherBackup(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  const body = readJsonBody(req);
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

async function handleCsvs(req, res) {
  if (req.method !== 'GET') {
    res.status(405).end('Method not allowed');
    return;
  }

  const fileParam = req.query?.file;
  const fileName = typeof fileParam === 'string' ? fileParam : '';

  if (!existsSync(CSV_DIR)) {
    res.status(404).json({ error: 'data/ebay-abrechnung not found', files: [] });
    return;
  }

  const entries = readdirSync(CSV_DIR)
    .filter((name) => name.toLowerCase().endsWith('.csv'))
    .filter((name) => isEbayTransactionReportText(readFileSync(join(CSV_DIR, name), 'utf8')))
    .map((name) => {
      const stat = statSync(join(CSV_DIR, name));
      return { name, size: stat.size };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!fileName) {
    res.status(200).json({ files: entries });
    return;
  }

  if (!entries.some((entry) => entry.name === fileName)) {
    res.status(404).json({ error: 'CSV not found' });
    return;
  }

  const text = readFileSync(join(CSV_DIR, fileName), 'utf8');
  res.status(200);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.end(text);
}

export default async function handler(req, res) {
  const apiRes = enhanceResponse(res);
  const route = req.query?.route;

  if (route === 'matcher') return handleMatcherBackup(req, apiRes);
  if (route === 'csvs') return handleCsvs(req, apiRes);
  return handleBackup(req, apiRes);
}
