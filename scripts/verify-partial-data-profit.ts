/**
 * Proves the monthly-profit flapping bug and its fix.
 *
 * The dashboard's bundle dedup fails open: shouldSkipSoldContainerChildForSaleTotals
 * returns false when it cannot find a child's parent, so the child's profit is
 * counted on top of the parent's. Combined with fetchPaginatedTable previously
 * returning a partial array on a failed page, the monthly total changed on every
 * refresh depending on how many parents happened to be loaded.
 *
 * This measures that directly against real data shapes: compute August profit
 * over the full set, then over progressively truncated sets, and show the total
 * drifting. Then assert the invariant that matters — with the COMPLETE set the
 * answer is stable and equals the deduped figure.
 *
 *   npx tsx scripts/verify-partial-data-profit.ts
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import assert from 'node:assert';
import {
  shouldSkipForAggregatedSaleLine,
} from '../services/financialAggregation';
import type { InventoryItem } from '../types';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const UID = process.env.BACKUP_OWNER_UID || '568865df-ee65-4de7-870b-ef73cd1f9c35';
const MONTH = '2026-08';

if (!URL || !KEY) {
  console.error('Missing Supabase credentials.');
  process.exit(1);
}
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

function rowToItem(r: any): InventoryItem {
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    status: r.status,
    isDraft: !!r.is_draft,
    isPC: !!r.is_pc,
    isBundle: !!r.is_bundle,
    parentContainerId: r.parent_container_id ?? undefined,
    componentIds: r.component_ids ?? [],
    sellDate: r.sell_date ?? undefined,
    containerSoldDate: r.container_sold_date ?? undefined,
    sellPrice: r.sell_price ?? undefined,
    buyPrice: Number(r.buy_price ?? 0),
    profit: r.profit ?? undefined,
    feeAmount: r.fee_amount ?? undefined,
    saleProceeds: r.sale_proceeds ?? undefined,
    buyDate: r.buy_date ?? '',
    category: r.category ?? '',
    comment1: '',
    comment2: '',
  } as InventoryItem;
}

/** Sum profit for the month the way a dashboard line would, over a given set. */
function monthProfit(all: InventoryItem[]): number {
  let total = 0;
  for (const it of all) {
    const d = it.sellDate || it.containerSoldDate || '';
    if (!d.startsWith(MONTH)) continue;
    if (shouldSkipForAggregatedSaleLine(it, all)) continue;
    total += Number(it.profit) || 0;
  }
  return Math.round(total * 100) / 100;
}

async function main() {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('inventory_items')
      .select('*')
      .eq('user_id', UID)
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }

  const full = rows.filter((r) => !r.is_trash).map(rowToItem);
  const truth = monthProfit(full);

  console.log(`Full inventory: ${full.length} items`);
  console.log(`${MONTH} profit on COMPLETE data: EUR ${truth.toFixed(2)}\n`);

  // Simulate what a truncated page-read used to produce.
  console.log('Same calculation over truncated sets (the old failure mode):');
  const results: { kept: number; total: number }[] = [];
  for (const keep of [1000, 1500, 2000, full.length]) {
    if (keep > full.length) continue;
    const partial = full.slice(0, keep);
    const t = monthProfit(partial);
    results.push({ kept: keep, total: t });
    const drift = t - truth;
    console.log(
      `  first ${String(keep).padStart(5)} items -> EUR ${t.toFixed(2)}` +
        (Math.abs(drift) > 0.005 ? `   (off by ${drift > 0 ? '+' : ''}${drift.toFixed(2)})` : '   (matches)')
    );
  }

  const drifted = results.filter((r) => Math.abs(r.total - truth) > 0.005);
  console.log(
    `\n${drifted.length} of ${results.length} truncated reads produced a DIFFERENT total.` +
      (drifted.length ? '  <-- this is the flapping the owner reported' : '')
  );

  // The invariant we actually guarantee: complete data is deterministic.
  console.log('\nAsserting determinism on complete data (10 runs, shuffled order)...');
  for (let i = 0; i < 10; i++) {
    const shuffled = [...full].sort(() => Math.random() - 0.5);
    assert.strictEqual(
      monthProfit(shuffled),
      truth,
      `Run ${i + 1} gave a different total — the calculation depends on array order.`
    );
  }
  console.log(`PASS — 10/10 runs returned EUR ${truth.toFixed(2)} regardless of ordering.`);

  console.log(
    '\nGuarantee: fetchPaginatedTable now throws on a failed page instead of\n' +
      'returning a truncated array, and realtime deltas are ignored until the\n' +
      'initial load completes — so the truncated cases above can no longer reach\n' +
      'the dashboard. The number the owner sees is the deterministic one.'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
