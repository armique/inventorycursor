/**
 * Compare every sold item's sell cell against Hub archive ledger values.
 * Run: npx tsx scripts/audit-item-hub-sell-mismatch.ts
 * Apply fixes (dry-run by default): npx tsx scripts/fix-hub-sell-from-archive.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { POCKET_PROFIT_TAX_MODE } from '../services/financialAggregation';
import type { InventoryItem } from '../types';
import type { EbayOrderRecord } from '../services/ebayOrderIndex';
import {
  buildHubBreakdownReplacePlan,
  hubSellSplitDiffersFromItem,
  type HubBreakdownReplaceRow,
} from '../utils/replaceItemSaleProceedsFromHub';
import { hubSaleColumnSplitForItem } from '../utils/hubOrderProceeds';
import { saleColumnSplit, saleProceedsFromItemFields } from '../utils/saleProceeds';

function loadLiveDump(): { items: InventoryItem[]; orders: EbayOrderRecord[] } {
  const dumpPath = path.join(process.cwd(), 'scripts', 'output', 'live-hub-audit.json');
  if (!fs.existsSync(dumpPath)) {
    throw new Error('Missing scripts/output/live-hub-audit.json — export live data first.');
  }
  return JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
}

export type ItemHubMismatch = {
  itemId: string;
  itemName: string;
  orderId: string;
  reason: HubBreakdownReplaceRow['reason'];
  source: string;
  beforeTotal: number | null;
  afterTotal: number | null;
  beforeNet: number | null;
  afterNet: number | null;
  netDelta: number | null;
  beforeProfit: number | null;
  afterProfit: number | null;
  profitDelta: number | null;
};

export function auditItemHubSellMismatches(
  items: InventoryItem[],
  orders: EbayOrderRecord[]
): ItemHubMismatch[] {
  const plan = buildHubBreakdownReplacePlan(items, orders, POCKET_PROFIT_TAX_MODE);
  return plan
    .filter((row) => row.reason !== 'order_meta')
    .map((row) => ({
      itemId: row.itemId,
      itemName: row.itemName,
      orderId: row.orderId,
      reason: row.reason,
      source: row.before.source,
      beforeTotal: row.before.total,
      afterTotal: row.after.total,
      beforeNet: row.before.net,
      afterNet: row.after.net,
      netDelta:
        row.before.net != null && row.after.net != null
          ? Math.round((row.after.net - row.before.net) * 100) / 100
          : null,
      beforeProfit: row.before.profit,
      afterProfit: row.after.profit,
      profitDelta:
        row.before.profit != null && row.after.profit != null
          ? Math.round((row.after.profit - row.before.profit) * 100) / 100
          : null,
    }));
}

/** Items stamped ebay_seller_hub but sell cell still differs from current Hub ledger. */
export function auditWrongHubAppliedItems(
  items: InventoryItem[],
  orders: EbayOrderRecord[]
): ItemHubMismatch[] {
  return auditItemHubSellMismatches(items, orders).filter(
    (m) => m.source === 'ebay_seller_hub' || m.reason === 'differs'
  );
}

/** Direct split diff scan (includes rows buildHubBreakdownReplacePlan might skip). */
export function scanDirectSplitDiffs(items: InventoryItem[], orders: EbayOrderRecord[]) {
  const byOrder = new Map(orders.map((o) => [o.orderId.trim().toLowerCase().replace(/[\s_]/g, ''), o]));
  const out: Array<{
    itemId: string;
    itemName: string;
    orderId: string;
    itemNet: number | null;
    hubNet: number | null;
    itemTotal: number | null;
    hubTotal: number | null;
    source: string;
  }> = [];

  for (const item of items) {
    const oid = (item.ebayOrderId || '').trim();
    if (!oid) continue;
    const order = byOrder.get(oid.toLowerCase().replace(/[\s_]/g, ''));
    if (!order) continue;
    const hubSplit = hubSaleColumnSplitForItem(order, item, items);
    if (!hubSellSplitDiffersFromItem(item, hubSplit)) continue;
    const itemSplit = saleColumnSplit(item, {
      displaySellEur: item.saleProceeds?.buyerTotalEur ?? item.sellPrice,
    });
    const cur = saleProceedsFromItemFields(item);
    out.push({
      itemId: item.id,
      itemName: item.name,
      orderId: order.orderId,
      itemNet: itemSplit?.netEur ?? cur.netPayoutEur ?? null,
      hubNet: hubSplit.netEur,
      itemTotal: itemSplit?.totalEur ?? cur.buyerTotalEur ?? item.sellPrice ?? null,
      hubTotal: hubSplit.totalEur,
      source: cur.feesEstimated ? 'estimated' : cur.source || 'inferred',
    });
  }
  return out;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('audit-item-hub-sell-mismatch.ts')) {
  const { items, orders } = loadLiveDump();
  const mismatches = auditItemHubSellMismatches(items, orders);
  const wrongHub = auditWrongHubAppliedItems(items, orders);
  const direct = scanDirectSplitDiffs(items, orders);

  console.log('Items in dump:', items.length);
  console.log('Hub orders:', orders.length);
  console.log('Replace-plan financial mismatches:', mismatches.length);
  console.log('Previously Hub-applied / differs:', wrongHub.length);
  console.log('Direct split diffs (any field):', direct.length);

  if (mismatches.length) {
    console.log('\n--- Financial fixes needed ---');
    for (const m of mismatches) {
      console.log(
        `  ${m.orderId} · ${m.itemName.slice(0, 55)} · ${m.reason} · source=${m.source}` +
          ` · net ${m.beforeNet} → ${m.afterNet} (Δ ${m.netDelta})` +
          ` · margin ${m.beforeProfit} → ${m.afterProfit} (Δ ${m.profitDelta})`
      );
    }
  }

  const directNotInPlan = direct.filter(
    (d) => !mismatches.some((m) => m.itemId === d.itemId)
  );
  if (directNotInPlan.length) {
    console.log('\n--- Split diffs NOT in replace plan (investigate) ---');
    for (const d of directNotInPlan.slice(0, 20)) {
      console.log(
        `  ${d.orderId} · ${d.itemName.slice(0, 55)} · source=${d.source}` +
          ` · net ${d.itemNet} vs hub ${d.hubNet} · total ${d.itemTotal} vs hub ${d.hubTotal}`
      );
    }
  }

  const outPath = path.join(process.cwd(), 'scripts', 'output', 'hub-sell-mismatch-report.json');
  fs.writeFileSync(
    outPath,
    JSON.stringify({ at: new Date().toISOString(), mismatches, wrongHub, direct, directNotInPlan }, null, 2)
  );
  console.log('\nWrote', outPath);

  process.exit(mismatches.length ? 1 : 0);
}
