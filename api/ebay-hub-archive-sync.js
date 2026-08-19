/**
 * Incremental Seller Hub scrape: new orders since fromDate with full payout split.
 * Local-only (Playwright CDP). Vercel returns local_only.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { EBAY_SELLER_HUB_ORDERS_URL } from '../lib/ebaySellerHubPayout.js';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function bodyOf(req) {
  if (req.body == null) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body || '{}');
    } catch {
      return {};
    }
  }
  return req.body;
}

function lastJsonLine(stdout) {
  const lines = String(stdout || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.startsWith('{')) continue;
    try {
      return JSON.parse(line);
    } catch {
      /* keep looking */
    }
  }
  return null;
}

function runIncremental(payload, timeoutMs = 180000) {
  const script = resolve(process.cwd(), 'scripts/ebay-hub-archive-export.mjs');
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [script, '--incremental'], {
      cwd: process.cwd(),
      env: { ...process.env, HUB_INCREMENTAL: '1' },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolvePromise({
        ok: false,
        code: 'scrape_error',
        openUrl: EBAY_SELLER_HUB_ORDERS_URL,
        error: err.message,
      });
    });
    child.on('close', () => {
      clearTimeout(timer);
      const parsed = lastJsonLine(stdout);
      if (parsed) {
        resolvePromise(parsed);
        return;
      }
      resolvePromise({
        ok: false,
        code: 'scrape_error',
        openUrl: EBAY_SELLER_HUB_ORDERS_URL,
        error: stderr.slice(-400) || 'No output from Hub incremental scrape',
        hint: 'Start debug Chrome with npm run chrome:cdp and stay logged into eBay.de.',
      });
    });
    child.stdin.write(
      JSON.stringify({
        incremental: true,
        fromDate: payload.fromDate,
        toDate: payload.toDate,
        knownOrderIds: payload.knownOrderIds,
        limit: payload.limit,
      })
    );
    child.stdin.end();
  });
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (process.env.VERCEL) {
    return res.status(200).json({
      ok: false,
      code: 'local_only',
      openUrl: EBAY_SELLER_HUB_ORDERS_URL,
      hint: 'Hub fee scrape needs npm run dev:ebay (Chrome on port 9222, logged into eBay.de).',
    });
  }

  const body = bodyOf(req);
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = String(body.fromDate || today).slice(0, 10);
  const toDate = String(body.toDate || today).slice(0, 10);
  const knownOrderIds = Array.isArray(body.knownOrderIds)
    ? body.knownOrderIds.map((id) => String(id).trim()).filter(Boolean)
    : [];
  const limit = Number(body.limit) > 0 ? Number(body.limit) : undefined;

  const result = await runIncremental({ fromDate, toDate, knownOrderIds, limit });
  return res.status(200).json(result);
}
