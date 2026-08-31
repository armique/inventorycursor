/** Verifies the daily backup: builds a real snapshot from Supabase and exercises
 *  the retention planner. Read-only — writes nothing to Supabase or GitHub. */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'node:fs';
import { buildSnapshot, planRetention } from '../lib/apiHandlers/dailyBackupHandler.js';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const UID = process.env.BACKUP_OWNER_UID || '568865df-ee65-4de7-870b-ef73cd1f9c35';
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

console.log('=== 1. Building a real snapshot from Supabase ===');
const snap = await buildSnapshot(sb, UID);
console.log(JSON.stringify(snap.manifest, null, 1));
const bytes = Buffer.byteLength(JSON.stringify(snap), 'utf8');
console.log(`serialized size: ${(bytes/1024/1024).toFixed(2)} MB`);

const outFile = 'data/live-backups/backup-sample.json';
fs.mkdirSync('data/live-backups', { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(snap));
console.log(`sample written to ${outFile} (for restore dry-run testing)`);

console.log('\n=== 2. Retention planner ===');
const days = [];
for (let i = 0; i < 400; i++) {
  const d = new Date(Date.UTC(2026, 7, 31) - i * 86400000).toISOString().slice(0, 10);
  days.push({ name: `${d}.json`, day: d, path: `backups/${d}.json`, sha: 'x' });
}
const { keep, prune } = planRetention(days);
console.log(`input: ${days.length} daily backups spanning ${days[days.length-1].day} .. ${days[0].day}`);
console.log(`keep : ${keep.length}   prune: ${prune.length}`);
console.log('newest kept :', keep.slice(0, 3).map(k => k.day).join(', '));
console.log('oldest kept :', keep.slice(-3).map(k => k.day).join(', '));
const est = (bytes * keep.length) / 1024 / 1024;
console.log(`\nestimated repo size at steady state: ~${est.toFixed(0)} MB (${keep.length} files, uncompressed)`);

console.log('\n=== 3. Sanity checks ===');
const m = snap.manifest;
const checks = [
  ['inventory_items present', m.rowCounts.inventory_items > 0],
  ['user_profiles captured', m.rowCounts.user_profiles === 1],
  ['taxMode recorded', !!m.taxMode],
  ['linked fingerprint present', m.linkedItems > 0 && m.distinctLinkedOrders > 0],
  ['active+trashed = total', m.inventoryActive + m.inventoryTrashed === m.rowCounts.inventory_items],
  ['retention keeps <= 40 files', keep.length <= 40],
  ['retention keeps newest day', keep[0].day === days[0].day],
];
let ok = true;
for (const [label, pass] of checks) { console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`); if (!pass) ok = false; }
console.log(ok ? '\nALL CHECKS PASSED' : '\nSOME CHECKS FAILED');
process.exit(ok ? 0 : 1);
