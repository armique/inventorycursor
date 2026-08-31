/**
 * READ-ONLY analysis of the Differenzbesteuerung (§25a UStG) gap.
 *
 * Two changes together removed margin VAT from every number the app reports:
 *
 *   1. utils/saleProfit.ts (commit df4a0ad) dropped the DifferentialVAT branch,
 *      so calculateSaleProfit returns sell - buy - fee for every tax mode.
 *   2. services/taxService.ts only ever had a RegularVAT branch, so with
 *      taxMode = DifferentialVAT it reports estimatedVat = 0.
 *
 * Uses the app's OWN dedup rules. A first version of this script summed raw sold
 * rows and reported a margin inflated by every sold PC counted alongside its
 * parts — the same double-count this codebase exists to prevent.
 *
 * Changes nothing. Report only.
 */
import { getProductionClientReadOnly } from './lib/testTarget.mjs';
import { mapRowToItem } from '../services/supabaseService';
import {
  shouldSkipCompositionChild,
  shouldSkipContainerRow,
  resolvedSaleRevenue,
  roundMoney,
} from '../services/financialAggregation';
import type { InventoryItem } from '../types';

const YEAR = Number(process.argv[2]) || 2026;
const client = getProductionClientReadOnly();

const rows: Record<string, unknown>[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await client.from('inventory_items').select('*').range(from, from + 999);
  if (error) throw new Error(`read failed at ${from}: ${error.message}`);
  rows.push(...(data as Record<string, unknown>[]));
  if (data.length < 1000) break;
}

const all: InventoryItem[] = rows.filter((r) => !r.is_trash).map(mapRowToItem);
console.log(`read ${all.length} items\n`);

// The same three filters services/taxService.ts applies before counting revenue.
const counted = all.filter((item) => {
  if (item.isDraft) return false;
  if (shouldSkipCompositionChild(item, all)) return false;
  if (shouldSkipContainerRow(item, all)) return false;
  if (!item.sellDate || new Date(item.sellDate).getFullYear() !== YEAR) return false;
  return item.status === 'Sold' || item.status === 'Traded' || item.status === 'Gifted';
});

let positiveMargin = 0;
let negativeMargin = 0;
let revenue = 0;
let cost = 0;

for (const item of counted) {
  const sell = resolvedSaleRevenue(item);
  const buy = Number(item.buyPrice) || 0;
  revenue += sell;
  cost += buy;
  const margin = sell - buy;
  if (margin > 0) positiveMargin += margin;
  else negativeMargin += margin;
}

// §25a: VAT is owed per sale on its positive margin. A loss-making sale does not
// generate a credit against other sales, so negative margins are not netted off.
const vatOwed = positiveMargin * (0.19 / 1.19);

const eur = (n: number) => `EUR ${roundMoney(n).toFixed(2).padStart(11)}`;

console.log(`Differenzbesteuerung (§25a) for ${YEAR}, after the app's own dedup\n`);
console.log(`  sale lines counted       ${String(counted.length).padStart(11)}`);
console.log(`  revenue                  ${eur(revenue)}`);
console.log(`  cost of those items      ${eur(cost)}`);
console.log(`  margin                   ${eur(revenue - cost)}`);
console.log(`    positive margins       ${eur(positiveMargin)}`);
console.log(`    negative margins       ${eur(negativeMargin)}`);
console.log('');
console.log(`  margin VAT owed          ${eur(vatOwed)}`);
console.log(`  app currently reports    ${eur(0)}`);
console.log('');
console.log('Report only — nothing was changed.');
