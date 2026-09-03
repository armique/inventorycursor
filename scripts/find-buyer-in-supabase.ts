import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { mapRowToItem } from '../services/supabaseService';
import type { InventoryItem } from '../types';
import { ItemStatus } from '../types';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  'https://lkmxlwpszekfuzqpqtrb.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const OWNER = process.env.BACKUP_OWNER_UID || '568865df-ee65-4de7-870b-ef73cd1f9c35';
const NEEDLE = (process.argv[2] || 'Tolga').toLowerCase();

if (!KEY) {
  console.error('No Supabase key');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });

function haystack(item: InventoryItem): string {
  const cycles = (item.ebaySaleCycles || [])
    .flatMap((c) => [c.customer?.name, c.customer?.email, c.ebayUsername, c.ebayOrderId])
    .filter(Boolean);
  return [
    item.name,
    item.comment1,
    item.comment2,
    item.customer?.name,
    item.customer?.email,
    item.ebayOrderId,
    item.ebayUsername,
    ...cycles,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

async function fetchAll() {
  const PAGE = 1000;
  let from = 0;
  const rows: Record<string, unknown>[] = [];
  while (true) {
    const { data, error } = await sb
      .from('inventory_items')
      .select('*')
      .eq('user_id', OWNER)
      .eq('is_trash', false)
      .order('updated_at', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows.map(mapRowToItem);
}

function describe(item: InventoryItem): string {
  const kind = item.isPC ? 'PC' : item.isBundle ? 'Bundle' : item.parentContainerId ? 'Part' : 'Item';
  const liveBuyer = item.customer?.name || item.customer?.email || '—';
  const archived = (item.ebaySaleCycles || [])
    .map((c) => c.customer?.name || c.ebayUsername || c.ebayOrderId)
    .filter(Boolean)
    .join(', ');
  return [
    `${item.name}`,
    `  id: ${item.id}`,
    `  status: ${item.status} · kind: ${kind}`,
    `  updated: ${(item as InventoryItem & { updated_at?: string }).updated_at ?? '?'}`,
    `  live buyer: ${liveBuyer}`,
    archived ? `  archived buyers/orders: ${archived}` : '',
    item.parentContainerId ? `  parent: ${item.parentContainerId}` : '',
    item.componentIds?.length ? `  parts: ${item.componentIds.length}` : '',
    item.comment2?.includes('[Returned') ? `  note: ${item.comment2.slice(0, 120)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function main() {
  console.log(`Searching inventory for "${NEEDLE}"…\n`);
  const items = await fetchAll();
  const hits = items.filter((i) => haystack(i).includes(NEEDLE));

  console.log(`Scanned ${items.length} rows · ${hits.length} match(es)\n`);

  if (hits.length) {
    console.log('=== MATCHES (newest updated first) ===');
    for (const h of hits.slice(0, 20)) {
      console.log(describe(h));
      console.log('');
    }
  }

  const restockedBundles = items.filter(
    (i) =>
      (i.isPC || i.isBundle) &&
      i.status === ItemStatus.IN_STOCK &&
      ((i.ebaySaleCycles?.length || 0) > 0 || /\[Returned/i.test(i.comment2 || '')),
  );

  const bundleHits = restockedBundles.filter((i) => haystack(i).includes(NEEDLE));
  if (bundleHits.length) {
    console.log('=== RESTOCKED BUNDLES/PCs WITH BUYER IN HISTORY ===');
    for (const b of bundleHits) {
      console.log(describe(b));
      console.log('');
    }
  }

  const recentActiveBundles = items
    .filter((i) => (i.isPC || i.isBundle) && i.status === ItemStatus.IN_STOCK)
    .slice(0, 15);
  console.log('=== 15 most recently updated Active bundles/PCs ===');
  for (const b of recentActiveBundles) {
    console.log(describe(b));
    console.log('');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
