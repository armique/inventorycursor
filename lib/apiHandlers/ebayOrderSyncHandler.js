/**
 * Vercel Cron: pull eBay orders + fee breakdowns into Supabase while the app is closed.
 *
 * Trigger: GET /api/ebay?route=order-sync-cron
 * Schedule: daily at 04:00 UTC (`0 4 * * *`).
 *
 * Required env:
 *   CRON_SECRET
 *   SUPABASE_SERVICE_ROLE_KEY
 *   VITE_SUPABASE_URL (or SUPABASE_URL)
 *   BACKUP_OWNER_UID (or EBAY_SYNC_OWNER_UID)
 *   EBAY_CLIENT_ID, EBAY_CLIENT_SECRET
 *   EBAY_SIGNING_PRIVATE_KEY_B64, EBAY_SIGNING_KEY_JWE (for fee breakdown via Finances API)
 */

import { createClient } from '@supabase/supabase-js';
import { runEbayOrderCloudSync } from '../ebayServerSync.js';

export async function handleEbayOrderSyncCron(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'GET or POST only' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    if ((req.headers?.authorization || '') !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
  }

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const userId = process.env.EBAY_SYNC_OWNER_UID || process.env.BACKUP_OWNER_UID;

  const missing = [
    !url && 'VITE_SUPABASE_URL',
    !key && 'SUPABASE_SERVICE_ROLE_KEY',
    !userId && 'BACKUP_OWNER_UID or EBAY_SYNC_OWNER_UID',
  ].filter(Boolean);

  if (missing.length) {
    console.error(`[ebay-order-sync-cron] Not configured — missing: ${missing.join(', ')}`);
    return res.status(500).json({ ok: false, error: `Missing env: ${missing.join(', ')}` });
  }

  const lookbackDays = Number(req.query?.days || process.env.EBAY_SYNC_LOOKBACK_DAYS || 30);
  const fromDate = process.env.EBAY_SYNC_FROM_DATE || '2026-08-28';

  try {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const result = await runEbayOrderCloudSync(sb, userId, { lookbackDays, fromDate });

    if (result.skipped) {
      console.warn('[ebay-order-sync-cron] Skipped:', result.reason);
      return res.status(200).json({ ok: true, skipped: true, reason: result.reason });
    }

    console.info(
      `[ebay-order-sync-cron] OK — fetched ${result.ordersFetched}, +${result.newOrderCount} new, ${result.reportOrderCount} in api-sync report`
    );

    return res.status(200).json(result);
  } catch (e) {
    console.error('[ebay-order-sync-cron] Failed:', e instanceof Error ? e.stack || e.message : e);
    return res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : 'eBay order sync failed',
    });
  }
}
