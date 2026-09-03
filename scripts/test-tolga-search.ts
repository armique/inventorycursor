import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { mapRowToItem } from '../services/supabaseService';
import { matchesInventorySearch } from '../utils/inventorySearchIndex';
import { itemMatchesActiveInventoryTab } from '../services/financialAggregation';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const sb = createClient(
  process.env.VITE_SUPABASE_URL || 'https://lkmxlwpszekfuzqpqtrb.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

async function main() {
  const id = 'pc-1774278941436';
  const { data, error } = await sb.from('inventory_items').select('*').eq('id', id).single();
  if (error) throw error;
  const item = mapRowToItem(data);
  console.log('item:', item.name);
  console.log('status:', item.status, 'isPC:', item.isPC);
  console.log('ebaySaleCycles:', item.ebaySaleCycles?.length);
  console.log('buyer in cycles:', item.ebaySaleCycles?.map((c) => c.customer?.name));
  console.log('match tolga:', matchesInventorySearch(item, 'tolga'));
  console.log('match palaz:', matchesInventorySearch(item, 'palaz'));

  const { data: all } = await sb
    .from('inventory_items')
    .select('*')
    .eq('user_id', data.user_id)
    .eq('is_trash', false);
  const items = (all || []).map(mapRowToItem);
  console.log('active tab:', itemMatchesActiveInventoryTab(item, items));

  console.log('\nraw row snippet:');
  console.log(JSON.stringify({
    status: data.status,
    customer: data.customer,
    comment2: data.comment2,
    ebay_sale_cycles: data.ebay_sale_cycles,
    ebay_order_id: data.ebay_order_id,
    updated_at: data.updated_at,
  }, null, 2));

  const tolgaItems = items.filter((i) =>
    matchesInventorySearch(i, 'tolga') || matchesInventorySearch(i, 'palaz'),
  );
  console.log(`\nAll items matching tolga/palaz: ${tolgaItems.length}`);
  for (const t of tolgaItems.slice(0, 10)) {
    console.log(`- ${t.name} | ${t.status} | id=${t.id} | customer=${t.customer?.name ?? '—'}`);
  }
  const pc = items.find((i) => i.id === id);
  if (pc) console.log('PC in bulk list match:', matchesInventorySearch(pc, 'tolga'), pc.customer?.name);
}

main();
