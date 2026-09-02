#!/usr/bin/env node
/**
 * Manual test for the server-side eBay order cron sync (same logic Vercel Cron runs).
 *
 * Usage (from repo root, with .env loaded):
 *   node scripts/run-ebay-order-sync-cron.mjs
 *
 * Requires: SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_URL, BACKUP_OWNER_UID,
 *           EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, and eBay refresh token in user_profiles.
 */

import { createClient } from '@supabase/supabase-js';
import { runEbayOrderCloudSync } from '../lib/ebayServerSync.js';

function pickEnv(name) {
  return process.env[name] || '';
}

async function main() {
  const url = pickEnv('VITE_SUPABASE_URL') || pickEnv('SUPABASE_URL');
  const key = pickEnv('SUPABASE_SERVICE_ROLE_KEY');
  const userId = pickEnv('EBAY_SYNC_OWNER_UID') || pickEnv('BACKUP_OWNER_UID');

  if (!url || !key || !userId) {
    console.error('Missing VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or BACKUP_OWNER_UID');
    process.exit(1);
  }

  const lookbackDays = Number(process.env.EBAY_SYNC_LOOKBACK_DAYS || 30);
  const sb = createClient(url, key, { auth: { persistSession: false } });

  console.log(`[ebay-order-sync] Running for user ${userId}, lookback ${lookbackDays} days…`);
  const result = await runEbayOrderCloudSync(sb, userId, { lookbackDays });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok && !result.skipped) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
