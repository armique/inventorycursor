/**
 * READ-ONLY free-tier headroom check against PRODUCTION.
 *
 * Staying inside Supabase's free tier is a hard requirement for this app, and
 * the limits that bite are not the obvious one. The database is tiny; egress and
 * file storage are what actually run out. So this measures real bytes rather
 * than estimating from row counts:
 *
 *   - egress: the actual JSON payload one app boot downloads
 *   - storage: the real size of every file in the inventory-images bucket
 *   - database: payload size as a floor, with the real figure noted as separate
 *
 * Then projects each to 10,000 items, the stated target.
 *
 * Free tier (as of 2026): 500 MB database, 5 GB egress/month,
 * 1 GB file storage, 2M realtime messages/month.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) throw new Error('Missing production credentials.');

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const MB = 1024 * 1024;
const GB = 1024 * MB;
const fmt = (b) => (b >= GB ? `${(b / GB).toFixed(2)} GB` : `${(b / MB).toFixed(1)} MB`);

// --- 1. what one boot downloads -------------------------------------------
let bootBytes = 0;
let itemCount = 0;
for (let from = 0; ; from += 1000) {
  const res = await fetch(`${URL_}/rest/v1/inventory_items?select=*`, {
    headers: { ...H, Range: `${from}-${from + 999}`, Prefer: 'count=exact' },
  });
  const text = await res.text();
  bootBytes += new TextEncoder().encode(text).length;
  const rows = JSON.parse(text);
  itemCount += rows.length;
  if (rows.length < 1000) break;
}

// Other tables the app pulls on boot.
let otherBytes = 0;
const otherCounts = {};
for (const t of ['ebay_orders', 'ebay_tx_reports', 'expenses', 'recurring_expenses', 'action_history', 'bulk_imports', 'user_profiles']) {
  let n = 0;
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${URL_}/rest/v1/${t}?select=*`, {
      headers: { ...H, Range: `${from}-${from + 999}` },
    });
    const text = await res.text();
    otherBytes += new TextEncoder().encode(text).length;
    const rows = JSON.parse(text);
    n += rows.length;
    if (rows.length < 1000) break;
  }
  otherCounts[t] = n;
}

const perItem = bootBytes / Math.max(1, itemCount);
const bootTotal = bootBytes + otherBytes;

console.log('Free-tier headroom — measured against production\n');
console.log('BOOT PAYLOAD (drives egress)');
console.log(`  inventory_items      ${String(itemCount).padStart(6)} rows   ${fmt(bootBytes)}`);
for (const [t, n] of Object.entries(otherCounts)) {
  console.log(`  ${t.padEnd(20)} ${String(n).padStart(6)} rows`);
}
console.log(`  other tables total                  ${fmt(otherBytes)}`);
console.log(`  ONE FULL BOOT                       ${fmt(bootTotal)}`);
console.log(`  average per item                    ${(perItem / 1024).toFixed(2)} KB`);

// --- 2. file storage -------------------------------------------------------
async function bucketSize(bucket) {
  let total = 0;
  let files = 0;
  const walk = async (prefix, depth) => {
    if (depth > 4) return;
    let offset = 0;
    for (;;) {
      const res = await fetch(`${URL_}/storage/v1/object/list/${bucket}`, {
        method: 'POST',
        headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
      });
      if (!res.ok) return;
      const entries = await res.json();
      if (!Array.isArray(entries) || entries.length === 0) return;
      for (const e of entries) {
        const size = e?.metadata?.size;
        if (typeof size === 'number') {
          total += size;
          files++;
        } else if (e.id === null || e.metadata == null) {
          await walk(prefix ? `${prefix}/${e.name}` : e.name, depth + 1);
        }
      }
      if (entries.length < 1000) return;
      offset += 1000;
    }
  };
  await walk('', 0);
  return { total, files };
}

const imgs = await bucketSize('inventory-images');
console.log('\nFILE STORAGE (limit 1 GB)');
console.log(`  inventory-images     ${String(imgs.files).padStart(6)} files  ${fmt(imgs.total)}`);
console.log(`  used                                ${((imgs.total / GB) * 100).toFixed(1)}% of 1 GB`);
const perPhoto = imgs.files ? imgs.total / imgs.files : 0;
if (perPhoto) console.log(`  average photo                       ${(perPhoto / 1024).toFixed(0)} KB`);

// --- 3. projection to 10,000 items ----------------------------------------
const TARGET = 10000;
const scale = TARGET / Math.max(1, itemCount);
const bootAt10k = perItem * TARGET + otherBytes;

console.log(`\nPROJECTED AT ${TARGET.toLocaleString()} ITEMS (x${scale.toFixed(1)} current)`);
console.log(`  one boot                            ${fmt(bootAt10k)}`);
console.log(`  db rows (payload as floor)          ${fmt(perItem * TARGET)}`);
console.log(`  photos, same rate                   ${fmt(imgs.total * scale)}`);

// Anchor to real measured usage rather than guessing a boot count. Read from the
// dashboard on 2026-08-31: 1.716 GB used with 26 of 31 days elapsed. Egress is
// billed ORG-WIDE across every project, so the test project — and these analysis
// scripts, each of which pulls a full copy of the inventory — draw on the same
// 5 GB as the live app. Do not run this on a loop.
const MEASURED_GB = 1.716;
const MEASURED_DAYS = 26;
const monthlyNow = (MEASURED_GB / MEASURED_DAYS) * 30;
// Boot payload is part fixed (profile, expenses) and part per-item, so scale by
// the boot ratio rather than the item ratio.
const bootRatio = bootAt10k / bootTotal;
const monthlyAt10k = monthlyNow * bootRatio;

console.log('\nEGRESS — MEASURED, NOT ESTIMATED (limit 5 GB/month, org-wide)');
console.log(`  now, ${itemCount} items              ${monthlyNow.toFixed(2)} GB/mo   ${((monthlyNow / 5) * 100).toFixed(0)}% of 5 GB`);
console.log(`  at ${TARGET} items (x${bootRatio.toFixed(1)} boot)     ${monthlyAt10k.toFixed(2)} GB/mo   ${((monthlyAt10k / 5) * 100).toFixed(0)}% of 5 GB${monthlyAt10k > 5 ? '   OVER' : ''}`);

// Where it actually breaks: the item count whose boot payload pushes monthly
// egress to 5 GB, holding the fixed portion and the rate of app opens constant.
const headroomBytes = (5 / monthlyNow) * bootTotal;
const ceiling = Math.round((headroomBytes - otherBytes) / perItem);
console.log(`\n  at the current rate of app opens, the free tier runs out`);
console.log(`  at roughly ${ceiling.toLocaleString()} items.`);

console.log('\nWORST-CASE COLD BOOTS (no cache)');
for (const boots of [5, 10, 20, 40]) {
  const monthly = bootAt10k * boots * 30;
  const pct = (monthly / (5 * GB)) * 100;
  const flag = pct > 100 ? '  OVER' : pct > 60 ? '  tight' : '';
  console.log(`  ${String(boots).padStart(3)} full boots/day        ${fmt(monthly).padStart(9)}/mo   ${pct.toFixed(0)}% of 5 GB${flag}`);
}
console.log('\n  A "full boot" is a cold load with no cache. Cache-first boot means');
console.log('  most opens re-read far less than this, so these are worst cases.');

console.log('\nNothing was written. Report only.');
