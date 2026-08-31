/**
 * Restore a Supabase account from a daily backup file.
 *
 * Defaults to a DRY RUN — it reports exactly what it would write and changes
 * nothing. Pass --apply to actually restore.
 *
 *   node scripts/restore-from-backup.mjs --file backups/2026-08-31.json
 *   node scripts/restore-from-backup.mjs --file <path> --apply
 *   node scripts/restore-from-backup.mjs --file <path> --apply --tables inventory_items,user_profiles
 *
 * Restores by upsert on primary key, so re-running is safe and it never deletes
 * rows that exist now but not in the backup (use --prune to also remove those).
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name) => args.includes(`--${name}`);

const file = getArg('file');
const apply = has('apply');
const prune = has('prune');
const onlyTables = (getArg('tables') || '').split(',').map((s) => s.trim()).filter(Boolean);

if (!file) {
  console.error('Usage: node scripts/restore-from-backup.mjs --file <backup.json> [--apply] [--prune] [--tables a,b]');
  process.exit(1);
}

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

/** Primary key per table — everything upserts on this. */
const PK = {
  inventory_items: 'id',
  expenses: 'id',
  recurring_expenses: 'id',
  ebay_orders: 'id',
  ebay_tx_reports: 'id',
  action_history: 'id',
  bulk_imports: 'id',
  user_profiles: 'id',
};

async function currentCount(table, userId) {
  const col = table === 'user_profiles' ? 'id' : 'user_id';
  const { count, error } = await sb.from(table).select('id', { count: 'exact', head: true }).eq(col, userId);
  return error ? `err(${error.message.slice(0, 30)})` : count;
}

async function main() {
  const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
  const userId = snapshot.userId;
  const tables = snapshot.tables || {};

  console.log(`\nBackup file : ${file}`);
  console.log(`Taken at    : ${snapshot.snapshotAt}`);
  console.log(`Account     : ${userId}`);
  console.log(`Mode        : ${apply ? 'APPLY (will write)' : 'DRY RUN (no writes)'}${prune ? ' + PRUNE' : ''}\n`);

  if (snapshot.manifest) {
    console.log('Manifest recorded in backup:');
    console.log(JSON.stringify(snapshot.manifest, null, 1));
    console.log('');
  }

  const names = Object.keys(tables).filter((t) => (onlyTables.length ? onlyTables.includes(t) : true));

  console.log('table'.padEnd(22), 'in backup'.padStart(10), 'in supabase now'.padStart(16));
  for (const t of names) {
    const now = await currentCount(t, userId);
    console.log(t.padEnd(22), String(tables[t].length).padStart(10), String(now).padStart(16));
  }
  console.log('');

  if (!apply) {
    console.log('Dry run complete — nothing was written. Re-run with --apply to restore.');
    return;
  }

  for (const t of names) {
    const rows = tables[t];
    if (!rows?.length) {
      console.log(`${t}: nothing in backup, skipped`);
      continue;
    }
    const pk = PK[t] || 'id';
    let written = 0;
    const BATCH = 200;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const { error } = await sb.from(t).upsert(chunk, { onConflict: pk });
      if (error) {
        console.error(`  ${t}: batch at ${i} FAILED — ${error.message}`);
        continue;
      }
      written += chunk.length;
    }
    console.log(`${t}: restored ${written}/${rows.length}`);

    if (prune) {
      const col = t === 'user_profiles' ? 'id' : 'user_id';
      const keepIds = new Set(rows.map((r) => r[pk]));
      const { data: existing } = await sb.from(t).select(pk).eq(col, userId);
      const extra = (existing || []).map((r) => r[pk]).filter((id) => !keepIds.has(id));
      if (extra.length) {
        for (let i = 0; i < extra.length; i += BATCH) {
          await sb.from(t).delete().in(pk, extra.slice(i, i + BATCH));
        }
        console.log(`  ${t}: pruned ${extra.length} row(s) not present in the backup`);
      }
    }
  }

  console.log('\nVerifying...');
  for (const t of names) {
    const now = await currentCount(t, userId);
    const want = tables[t].length;
    console.log(`  ${t.padEnd(22)} now ${String(now).padStart(6)}  (backup had ${want})${String(now) === String(want) ? '' : prune ? '  <-- MISMATCH' : '  (extra rows kept; use --prune to match exactly)'}`);
  }
  console.log('\nRestore finished.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
