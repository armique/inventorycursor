/**
 * Audit hub sell splits for all archived eBay orders linked to sold inventory rows.
 * Run: npx tsx scripts/audit-hub-sell-splits.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { ItemStatus, type InventoryItem } from '../types';
import type { EbayOrderRecord } from '../services/ebayOrderIndex';
import { hubSaleColumnSplit } from '../utils/saleProceeds';
import { getHubBestelleinnahmen, sumOrderFeeDeductions } from '../utils/ebayOrderFinancial';
import { roundMoney } from '../services/financialAggregation';

function loadLiveDump(): { items: InventoryItem[]; orders: EbayOrderRecord[] } | null {
  const dumpPath = path.join(process.cwd(), 'scripts', 'output', 'live-hub-audit.json');
  if (!fs.existsSync(dumpPath)) return null;
  return JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
}

function orderKey(id: string): string {
  return id.trim().toLowerCase().replace(/[\s_]/g, '');
}

function auditOrder(order: EbayOrderRecord): string | null {
  const fees = sumOrderFeeDeductions(order);
  if (fees < 0.01) return null;
  const split = hubSaleColumnSplit(order, 1);
  const net = getHubBestelleinnahmen(order);
  if (net == null) return `order ${order.orderId}: missing net`;
  if (Math.abs(split.netEur - net) >= 0.05) {
    return `order ${order.orderId}: split net ${split.netEur} != bestelleinnahmen ${net}`;
  }
  if (Math.abs(split.totalEur - split.netEur) < 0.02 && fees >= 0.01) {
    return `order ${order.orderId}: total equals net (${split.totalEur}) with fees ${fees}`;
  }
  const implied = roundMoney(split.netEur + split.shippingEur + split.ebayFeeEur + split.adFeeEur + split.otherFeeEur);
  if (Math.abs(implied - split.totalEur) >= 0.08) {
    return `order ${order.orderId}: ledger mismatch total ${split.totalEur} vs implied ${implied}`;
  }
  return null;
}

export function auditHubSellSplits(items: InventoryItem[], orders: EbayOrderRecord[]): string[] {
  const byOrder = new Map(orders.map((o) => [orderKey(o.orderId), o]));
  const seen = new Set<string>();
  const issues: string[] = [];

  for (const order of orders) {
    const issue = auditOrder(order);
    if (issue) issues.push(issue);
  }

  for (const item of items) {
    if (item.status !== ItemStatus.SOLD && item.status !== ItemStatus.TRADED) continue;
    const oid = (item.ebayOrderId || '').trim();
    if (!oid) continue;
    const key = orderKey(oid);
    if (seen.has(key)) continue;
    seen.add(key);
    const order = byOrder.get(key);
    if (!order) continue;
    if (!order.sources?.includes('hub')) continue;
    const issue = auditOrder(order);
    if (issue) issues.push(`${issue} · item ${item.name}`);
  }

  return issues;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('audit-hub-sell-splits.ts')) {
  const dump = loadLiveDump();
  if (!dump) {
    console.error('Missing scripts/output/live-hub-audit.json — export live data first.');
    process.exit(1);
  }
  const issues = auditHubSellSplits(dump.items, dump.orders);
  if (issues.length) {
    console.error('audit-hub-sell-splits: FAIL');
    for (const issue of issues.slice(0, 40)) console.error(' -', issue);
    if (issues.length > 40) console.error(` ... and ${issues.length - 40} more`);
    process.exit(1);
  }
  console.log('audit-hub-sell-splits: ok', dump.orders.length, 'orders');
}
