/**
 * Daily cron: snapshot the whole Supabase account into a dated JSON file committed
 * to a PRIVATE GitHub backup repo, then prune old backups to the retention policy.
 *
 * This is the single automated backup for the app. Design decisions worth keeping:
 *
 *  - It writes to GitHub, never to Supabase. A backup stored inside the system it
 *    protects is not a backup: if the Supabase project is lost, suspended, or
 *    corrupted, anything in Supabase Storage goes with it.
 *  - It runs server-side on a cron, not in the browser. Client-triggered backups
 *    only run when the app happens to be open, which is exactly not the case
 *    during the week something goes wrong.
 *  - Each run writes its own dated file and never overwrites yesterday's. A single
 *    rolling file means silent corruption is copied over the last good copy before
 *    anyone notices.
 *  - Every backup embeds a manifest of per-table row counts, so "did last night
 *    actually capture everything?" is answerable without downloading and parsing
 *    the whole file.
 *
 * Required env (Vercel project settings):
 *   SUPABASE_SERVICE_ROLE_KEY   read access that bypasses RLS
 *   VITE_SUPABASE_URL           (or SUPABASE_URL)
 *   GITHUB_BACKUP_TOKEN         PAT with contents read/write on the backup repo
 *   GITHUB_BACKUP_REPO          "owner/repo" — MUST be private
 *   BACKUP_OWNER_UID            Supabase auth uid whose data to back up
 *   CRON_SECRET                 set by Vercel Cron; rejects anything else
 */

import { createClient } from '@supabase/supabase-js';

/** Every table that must be present to rebuild the account from scratch. */
const USER_SCOPED_TABLES = [
  'inventory_items',
  'expenses',
  'recurring_expenses',
  'ebay_orders',
  'ebay_tx_reports',
  'action_history',
  'bulk_imports',
];

const PAGE = 1000;

async function fetchAllRows(sb, table, userId) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from(table)
      .select('*')
      .eq('user_id', userId)
      .range(from, from + PAGE - 1);
    // Fail loudly. A backup that silently skips a table it could not read is worse
    // than no backup, because it looks successful.
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

export async function buildSnapshot(sb, userId) {
  const tables = {};
  for (const table of USER_SCOPED_TABLES) {
    tables[table] = await fetchAllRows(sb, table, userId);
  }

  // user_profiles is keyed by `id`, not `user_id`, and holds business/tax settings.
  // It was missing from earlier backups, which is why a lost tax_mode could not be
  // checked against a known-good copy.
  const { data: profile, error: profErr } = await sb
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (profErr) throw new Error(`user_profiles: ${profErr.message}`);
  tables.user_profiles = profile ? [profile] : [];

  const counts = {};
  for (const [name, rows] of Object.entries(tables)) counts[name] = rows.length;

  const inv = tables.inventory_items || [];
  const linked = inv.filter((r) => (r.ebay_order_id || '').trim());

  return {
    schemaVersion: 3,
    source: 'supabase',
    userId,
    snapshotAt: new Date().toISOString(),
    manifest: {
      rowCounts: counts,
      // Same fingerprint used to verify nothing was damaged during the Aug 2026
      // CSV migration — cheap to record, and makes silent drift obvious.
      inventoryActive: inv.filter((r) => !r.is_trash).length,
      inventoryTrashed: inv.filter((r) => !!r.is_trash).length,
      linkedItems: linked.length,
      distinctLinkedOrders: new Set(linked.map((r) => r.ebay_order_id.trim())).size,
      taxMode: profile?.tax_mode ?? null,
    },
    tables,
  };
}

// --- GitHub -----------------------------------------------------------------

const GH = 'https://api.github.com';

async function gh(token, path, init = {}) {
  const res = await fetch(`${GH}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || `GitHub ${path} failed (${res.status})`);
  return json;
}

async function assertRepoIsPrivate(token, repo) {
  const info = await gh(token, `/repos/${repo}`);
  if (info.private !== true) {
    throw new Error(
      `Refusing to write backups to ${repo}: the repository is PUBLIC. Backups contain customer names, addresses and financial records.`
    );
  }
}

async function commitFile(token, repo, filePath, contents, message) {
  // Include the existing blob sha when the file is already there, otherwise GitHub
  // rejects the update. Re-running the cron on the same day should overwrite that
  // day's file, not fail.
  let sha;
  try {
    const existing = await gh(token, `/repos/${repo}/contents/${filePath}`);
    sha = existing?.sha;
  } catch {
    /* not found — first write of the day */
  }
  return gh(token, `/repos/${repo}/contents/${filePath}`, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: Buffer.from(contents, 'utf8').toString('base64'),
      ...(sha ? { sha } : {}),
    }),
  });
}

async function listBackups(token, repo) {
  try {
    const entries = await gh(token, `/repos/${repo}/contents/backups`);
    if (!Array.isArray(entries)) return [];
    return entries
      .filter((e) => e.type === 'file' && /^\d{4}-\d{2}-\d{2}\.json$/.test(e.name))
      .map((e) => ({ name: e.name, day: e.name.slice(0, 10), path: e.path, sha: e.sha }));
  } catch {
    return [];
  }
}

function isoWeekKey(day) {
  const d = new Date(`${day}T00:00:00Z`);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Keep the 14 most recent days, plus the newest backup in each of the last 8 ISO
 * weeks, plus the newest in each of the last 12 months. Anything else is prunable.
 */
export function planRetention(backups, { daily = 14, weekly = 8, monthly = 12 } = {}) {
  const sorted = [...backups].sort((a, b) => b.day.localeCompare(a.day));
  const keep = new Set();

  for (const b of sorted.slice(0, daily)) keep.add(b.name);

  const seenWeeks = new Set();
  for (const b of sorted) {
    const k = isoWeekKey(b.day);
    if (seenWeeks.has(k)) continue;
    seenWeeks.add(k);
    if (seenWeeks.size <= weekly) keep.add(b.name);
  }

  const seenMonths = new Set();
  for (const b of sorted) {
    const k = b.day.slice(0, 7);
    if (seenMonths.has(k)) continue;
    seenMonths.add(k);
    if (seenMonths.size <= monthly) keep.add(b.name);
  }

  return {
    keep: sorted.filter((b) => keep.has(b.name)),
    prune: sorted.filter((b) => !keep.has(b.name)),
  };
}

// --- handler ----------------------------------------------------------------

export async function handleDailyBackup(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'GET only' });

  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Without this check any
  // visitor could trigger a full account read plus GitHub writes.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    if ((req.headers?.authorization || '') !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
  }

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const githubToken = process.env.GITHUB_BACKUP_TOKEN;
  const githubRepo = process.env.GITHUB_BACKUP_REPO;
  const userId = process.env.BACKUP_OWNER_UID;

  const missing = [
    !url && 'VITE_SUPABASE_URL',
    !key && 'SUPABASE_SERVICE_ROLE_KEY',
    !githubToken && 'GITHUB_BACKUP_TOKEN',
    !githubRepo && 'GITHUB_BACKUP_REPO',
    !userId && 'BACKUP_OWNER_UID',
  ].filter(Boolean);
  if (missing.length) {
    return res.status(500).json({ ok: false, error: `Daily backup not configured — missing: ${missing.join(', ')}` });
  }

  try {
    await assertRepoIsPrivate(githubToken, githubRepo);

    const sb = createClient(url, key, { auth: { persistSession: false } });
    const snapshot = await buildSnapshot(sb, userId);

    // Refuse to write an empty snapshot over a good history. An auth/permission
    // failure that returns zero rows must not look like a successful backup.
    if ((snapshot.manifest.rowCounts.inventory_items || 0) === 0) {
      throw new Error('Snapshot contained 0 inventory items — refusing to write a backup that would look valid but be empty.');
    }

    const day = snapshot.snapshotAt.slice(0, 10);
    const filePath = `backups/${day}.json`;
    const m = snapshot.manifest;

    await commitFile(
      githubToken,
      githubRepo,
      filePath,
      JSON.stringify(snapshot),
      `Backup ${day} · ${m.inventoryActive} active, ${m.inventoryTrashed} trashed, ${m.linkedItems} linked / ${m.distinctLinkedOrders} orders`
    );

    // Prune only after the new backup is safely committed.
    const all = await listBackups(githubToken, githubRepo);
    const { keep, prune } = planRetention(all);
    const pruned = [];
    for (const b of prune) {
      try {
        await gh(githubToken, `/repos/${githubRepo}/contents/${b.path}`, {
          method: 'DELETE',
          body: JSON.stringify({ message: `Prune backup ${b.day} (retention policy)`, sha: b.sha }),
        });
        pruned.push(b.name);
      } catch {
        /* a failed prune must never fail the backup itself */
      }
    }

    return res.status(200).json({
      ok: true,
      filePath,
      manifest: m,
      retained: keep.length,
      pruned,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : 'Backup failed' });
  }
}
