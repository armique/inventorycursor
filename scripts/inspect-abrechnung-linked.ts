import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  buildEbayTxOrderLedgers,
  mergeEbayTxReports,
  parseEbayTransactionReport,
} from '../utils/ebayTransactionReport';
import { buildEbayTxBulkMatchSuggestions } from '../utils/ebayTxBulkMatchSuggestions';

const CSV_DIR = path.join(process.cwd(), 'data', 'ebay-abrechnung');
// Credentials from the environment ONLY — a service role key bypasses all RLS,
// so a hardcoded fallback here would be a full-access credential in the repo.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PRIMARY_OWNER_UID = '568865df-ee65-4de7-870b-ef73cd1f9c35';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in the environment (.env.local).');
  process.exit(1);
}

async function main() {
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  let all = [];
  let from = 0;
  while (true) {
    const { data } = await sb
      .from('inventory_items')
      .select('*')
      .eq('user_id', PRIMARY_OWNER_UID)
      .eq('is_trash', false)
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }

  const items = all.map((r: any) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    buyPrice: Number(r.buy_price || 0),
    sellPrice: Number(r.sell_price || 0),
    sellDate: r.sell_date,
    buyDate: r.buy_date,
    ebayOrderId: r.ebay_order_id,
    platformSold: r.platform_sold,
    saleProceeds: r.sale_proceeds,
  }));

  const files = fs
    .readdirSync(CSV_DIR)
    .filter((name) => name.toLowerCase().endsWith('.csv'))
    .sort();

  const reports = files.map((name) =>
    parseEbayTransactionReport(fs.readFileSync(path.join(CSV_DIR, name), 'utf8'), name)
  );

  const merged = mergeEbayTxReports(reports);
  if (!merged) return;
  const ledgers = buildEbayTxOrderLedgers(merged.rows);
  const suggestions = buildEbayTxBulkMatchSuggestions(items as any, merged.rows, ledgers);

  const linkedSuggestions = suggestions.filter((s) => s.confidence === 'linked');
  const highSuggestions = suggestions.filter((s) => s.confidence === 'high');
  const mediumSuggestions = suggestions.filter((s) => s.confidence === 'medium');
  const lowSuggestions = suggestions.filter((s) => s.confidence === 'low');
  const noneSuggestions = suggestions.filter((s) => s.confidence === 'none');

  console.log('=== EBAY ABRECHNUNG / MATCHER STATS on SUPABASE INVENTORY ===');
  console.log('Total orders in Abrechnung CSVs:', suggestions.length);
  console.log('Already Linked orders;', linkedSuggestions.length);
  console.log('High confidence suggestions:', highSuggestions.length);
  console.log('Medium confidence suggestions:', mediumSuggestions.length);
  console.log('Low confidence suggestions:', lowSuggestions.length);
  console.log('Unmatched / None suggestions:', noneSuggestions.length);
}

main().catch(console.error);
