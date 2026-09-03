/**
 * Local development read-through for Supabase.
 *
 * SECURITY — read before changing anything here:
 * This handler talks to Supabase with the SERVICE ROLE key, which bypasses all
 * Row Level Security. Anything it returns is returned without RLS filtering, so
 * the endpoint itself is the only access control there is. Therefore:
 *
 *   1. The service role key is read from the environment ONLY. There is no
 *      hardcoded fallback — a missing key must fail loudly, never silently fall
 *      back to a literal committed into the repo.
 *   2. The endpoint is DISABLED outside local development. It exists so the
 *      local dev-access mode (which has no Supabase auth session, and therefore
 *      cannot read through RLS) can still load data. In production the app is
 *      signed in and reads Supabase directly under RLS, so this is not needed —
 *      and if it were exposed there it would be an unauthenticated dump of the
 *      whole account to anyone who guessed the URL.
 *   3. CORS is not wildcarded. Same-origin only.
 */
import { createClient } from '@supabase/supabase-js';

/**
 * True only for genuine local development.
 *
 * Deliberately NOT based on env vars. This repo's .env.local was produced by
 * `vercel env pull` and literally contains VERCEL=1 and VERCEL_ENV="production";
 * Vite loads that file into process.env for the local dev server, so every
 * env-based "am I in production?" test reports a false positive on localhost.
 *
 * Instead this keys off request headers that only Vercel's edge can set. Those
 * are injected by the platform on every real invocation and cannot be stripped
 * by a caller, so a deployed request can never masquerade as local — while a
 * genuine localhost request never carries them. The Host check then pins it to
 * a loopback origin.
 */
function isLocalDev(req) {
  const h = req.headers || {};
  if (h['x-vercel-id'] || h['x-vercel-deployment-url'] || h['x-vercel-forwarded-for']) return false;
  const host = String(h.host || '').toLowerCase();
  return host.startsWith('localhost') || host.startsWith('127.0.0.1') || host.startsWith('[::1]');
}

let sbClient = null;
function getServiceClient() {
  if (sbClient) return sbClient;
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'supabase-sync: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment.'
    );
  }
  sbClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return sbClient;
}

async function fetchAll(sb, tableName, userId, orderBy = 'id') {
  const all = [];
  let from = 0;
  const pageSize = 1000;
  for (;;) {
    let q = sb.from(tableName).select('*').order(orderBy, { ascending: true }).range(from, from + pageSize - 1);
    if (userId) q = q.eq('user_id', userId);
    const { data, error } = await q;
    if (error) {
      console.error(`[api/supabase-sync] Error on ${tableName}:`, error);
      break;
    }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

export default async function handler(req, res) {
  // Not available anywhere but local development — see the security note above.
  if (!isLocalDev(req)) {
    return res.status(404).json({ error: 'Not found' });
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // POST { action: 'dev-session' } — mint a genuine Supabase session for the
  // owner so local development has the same RLS-backed read/write access as a
  // normal login. The service role key never leaves the server: what goes back
  // is a single-use magic-link token hash the client exchanges for a session.
  // Only reachable on localhost (isLocalDev above).
  if (req.method === 'POST') {
    const action = req.body?.action;
    if (action === 'session-backup') {
      try {
        const { mkdirSync, writeFileSync } = await import('fs');
        const { join } = await import('path');
        const fileName = String(req.body?.fileName || `deinventory-backup-${Date.now()}.json`);
        const backup = req.body?.backup;
        if (!backup) return res.status(400).json({ error: 'Missing backup payload' });
        const dir = join(process.cwd(), 'data', 'session-backups');
        mkdirSync(dir, { recursive: true });
        const path = join(dir, fileName);
        writeFileSync(path, JSON.stringify(backup, null, 2), 'utf8');
        return res.status(200).json({ ok: true, path: `data/session-backups/${fileName}` });
      } catch (err) {
        console.error('[api/supabase-sync] session-backup error:', err);
        return res.status(500).json({ ok: false, error: err.message || 'Write failed' });
      }
    }
    if (action !== 'dev-session') {
      return res.status(400).json({ error: 'Unsupported action' });
    }
    try {
      const sb = getServiceClient();
      const email = process.env.DEV_OWNER_EMAIL || 'abelyanarmen@gmail.com';
      const { data, error } = await sb.auth.admin.generateLink({ type: 'magiclink', email });
      if (error) return res.status(500).json({ ok: false, error: error.message });
      const tokenHash = data?.properties?.hashed_token;
      if (!tokenHash) return res.status(500).json({ ok: false, error: 'No token returned' });
      return res.status(200).json({ ok: true, tokenHash });
    } catch (err) {
      console.error('[api/supabase-sync] dev-session error:', err);
      return res.status(500).json({ ok: false, error: err.message || 'Server error' });
    }
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const userId = req.query?.userId;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  try {
    const sb = getServiceClient();
    const [items, expenses, recurringExpenses, profileRes, actionHistory, bulkImports, ebayOrders, ebayTxReports] =
      await Promise.all([
        fetchAll(sb, 'inventory_items', userId),
        fetchAll(sb, 'expenses', userId, 'date'),
        fetchAll(sb, 'recurring_expenses', userId),
        sb.from('user_profiles').select('*').eq('id', userId).maybeSingle(),
        fetchAll(sb, 'action_history', userId, 'timestamp'),
        fetchAll(sb, 'bulk_imports', userId, 'imported_at'),
        fetchAll(sb, 'ebay_orders', userId),
        fetchAll(sb, 'ebay_tx_reports', userId),
      ]);

    return res.status(200).json({
      ok: true,
      items,
      expenses,
      recurringExpenses,
      profile: profileRes.data || null,
      actionHistory,
      bulkImports,
      ebayOrders,
      ebayTxReports,
      count: items.length,
    });
  } catch (err) {
    console.error('[api/supabase-sync] Handler error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
