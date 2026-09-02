/**
 * Inspect Be Quiet PSU / order ids in Supabase inventory.
 * Run: npx tsx scripts/inspect-psu-item.ts
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { mapRowToItem } from '../services/supabaseService';
import type { InventoryItem } from '../types';
import { computeSoldTabMargin } from '../services/financialAggregation';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const OWNER = process.env.BACKUP_OWNER_UID || '568865df-ee65-4de7-870b-ef73cd1f9c35';

if (!SUPABASE_URL || !KEY) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });

const NEEDLES = [
  'bequiet',
  'be quiet',
  'pure power',
  'bq l8',
  'l8-500w',
  '97757',
  '02-14605-30138',
  '17-14636-61443',
];

function hay(item: InventoryItem): string {
  return [
    item.id,
    item.name,
    item.ebayOrderId,
    item.sellDate,
    item.customer?.name,
    item.ebayUsername,
    JSON.stringify(item.saleProceeds || {}),
    JSON.stringify(item.ebaySaleCycles || []),
  ]
    .join(' ')
    .toLowerCase();
}

async function fetchAll(): Promise<InventoryItem[]> {
  const out: InventoryItem[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from('inventory_items')
      .select('*')
      .eq('user_id', OWNER)
      .eq('is_trash', false)
      .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    out.push(...data.map(mapRowToItem));
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

function summarize(item: InventoryItem) {
  const margin = computeSoldTabMargin(item);
  return {
    id: item.id,
    name: item.name,
    status: item.status,
    buyPrice: item.buyPrice,
    sellPrice: item.sellPrice,
    storedProfit: item.profit,
    computedMargin: margin,
    sellDate: item.sellDate,
    buyDate: item.buyDate,
    ebayOrderId: item.ebayOrderId,
    ebayListingId: item.ebayListingId,
    ebayUsername: item.ebayUsername,
    customer: item.customer?.name,
    feeAmount: item.feeAmount,
    hasFee: item.hasFee,
    originalSellPrice: item.originalSellPrice,
    saleProceeds: item.saleProceeds,
    ebaySaleCycles: (item.ebaySaleCycles || []).map((c) => ({
      order: c.ebayOrderId,
      reason: c.reason,
      sellDate: c.sellDate,
      sellPrice: c.sellPrice,
      profit: c.profit,
      refundKind: c.refundKind,
      refundEur: c.refundEur,
      netPayoutEur: c.saleProceeds?.netPayoutEur,
      buyer: c.customer?.name,
    })),
    pendingRefundFeeOrderIds: item.pendingRefundFeeOrderIds,
    comment2Snippet: (item.comment2 || '').slice(0, 240),
  };
}

async function main() {
  const items = await fetchAll();
  console.log('Total items:', items.length);

  const orderNeedle = '02-14605-30138';
  const orderHits = items.filter((i) => hay(i).includes(orderNeedle.toLowerCase()));
  if (orderHits.length) {
    console.log('=== ITEMS MENTIONING ORDER', orderNeedle, '===');
    for (const item of orderHits) console.log(JSON.stringify(summarize(item), null, 2));
  }

  const byId = items.find((i) => i.id === 'bulk-1776454397757-18');
  if (byId) {
    console.log('=== TARGET ITEM bulk-1776454397757-18 ===');
    console.log(JSON.stringify(summarize(byId), null, 2));
  }

  const hits = items.filter((i) => NEEDLES.some((n) => hay(i).includes(n)));
  if (!hits.length) {
    const psus = items.filter((i) => /psu|netzteil|500w|be quiet|bequiet/i.test(i.name || ''));
    console.log('No direct hit. PSU-like sold rows:');
    for (const i of psus.filter((x) => x.status === 'Sold').slice(0, 15)) {
      console.log(JSON.stringify(summarize(i), null, 2));
    }
    return;
  }

  for (const item of hits) {
    console.log(JSON.stringify(summarize(item), null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
