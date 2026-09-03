import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  'https://lkmxlwpszekfuzqpqtrb.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_QR62aggcb-KO0H6pwig2zw_EyoQp0WJ';
const OWNER_UID = process.env.BACKUP_OWNER_UID || '568865df-ee65-4de7-870b-ef73cd1f9c35';

const key = SERVICE_KEY || ANON_KEY;
const usingService = Boolean(SERVICE_KEY);

if (!key) {
  console.error('No Supabase key available.');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });

type Row = {
  id: string;
  name: string;
  status: string;
  sell_date: string | null;
  sell_price: number | null;
  buy_price: number | null;
  profit: number | null;
  updated_at: string;
  is_trash: boolean;
  parent_container_id: string | null;
  is_bundle: boolean;
  is_pc: boolean;
  component_ids: string[] | null;
  ebay_order_id: string | null;
};

async function main() {
  console.log(`Supabase: ${SUPABASE_URL}`);
  console.log(`Auth: ${usingService ? 'service role' : 'anon key'}`);
  console.log(`Owner: ${OWNER_UID}\n`);

  const { data: bySellDate, error: e1 } = await sb
    .from('inventory_items')
    .select(
      'id,name,status,sell_date,sell_price,buy_price,profit,updated_at,is_trash,parent_container_id,is_bundle,is_pc,component_ids,ebay_order_id',
    )
    .eq('user_id', OWNER_UID)
    .eq('is_trash', false)
    .eq('status', 'Sold')
    .order('sell_date', { ascending: false, nullsFirst: false })
    .limit(5);

  if (e1) {
    console.error('Query by sell_date failed:', e1.message);
    process.exit(1);
  }

  const { data: byUpdated, error: e2 } = await sb
    .from('inventory_items')
    .select(
      'id,name,status,sell_date,sell_price,buy_price,profit,updated_at,is_trash,parent_container_id,is_bundle,is_pc,component_ids,ebay_order_id',
    )
    .eq('user_id', OWNER_UID)
    .eq('is_trash', false)
    .eq('status', 'Sold')
    .order('updated_at', { ascending: false })
    .limit(5);

  if (e2) {
    console.error('Query by updated_at failed:', e2.message);
    process.exit(1);
  }

  const rows = (bySellDate || []) as Row[];
  if (!rows.length) {
    console.log('No sold items returned (RLS may block anon key, or inventory empty).');
    process.exit(0);
  }

  console.log('=== Latest by sell_date (most recent sale day) ===');
  for (const r of rows) {
    printRow(r);
  }

  console.log('\n=== Latest by updated_at (most recently synced/edited sold row) ===');
  for (const r of (byUpdated || []) as Row[]) {
    printRow(r);
  }
}

function printRow(r: Row) {
  const kind = r.is_pc ? 'PC' : r.is_bundle ? 'Bundle' : r.parent_container_id ? 'Part' : 'Standalone';
  console.log(
    [
      `- ${r.name}`,
      `  id: ${r.id}`,
      `  sell_date: ${r.sell_date ?? '—'} · sell: €${r.sell_price ?? '—'} · profit: €${r.profit ?? '—'}`,
      `  updated_at: ${r.updated_at}`,
      `  kind: ${kind}${r.component_ids?.length ? ` (${r.component_ids.length} parts)` : ''}`,
      r.ebay_order_id ? `  ebay: ${r.ebay_order_id}` : '',
      r.parent_container_id ? `  parent: ${r.parent_container_id}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
