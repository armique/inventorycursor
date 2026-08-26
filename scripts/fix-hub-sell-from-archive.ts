/**
 * Build and optionally apply Hub-correct sell cell fixes against live inventory data.
 *
 * Audit:  npx tsx scripts/fix-hub-sell-from-archive.ts
 * Apply:  npx tsx scripts/fix-hub-sell-from-archive.ts --apply
 *         (patches scripts/output/hub-sell-fix-patches.json into localStorage via CDP)
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  POCKET_PROFIT_TAX_MODE,
  computeSoldTabMargin,
  healRealizedProfitsFromSaleProceeds,
  roundMoney,
} from '../services/financialAggregation';
import type { InventoryItem } from '../types';
import { ItemStatus } from '../types';
import type { EbayOrderRecord } from '../services/ebayOrderIndex';
import {
  applyHubBreakdownReplacePlan,
  buildHubBreakdownReplacePlan,
  buildHubApplyRowForItem,
  hubOrderIdFromItem,
  hubSellSplitDiffersFromItem,
  type HubBreakdownReplaceRow,
} from '../utils/replaceItemSaleProceedsFromHub';
import { hubSaleColumnSplitForItem, shouldSkipHubPlanForContainerChild } from '../utils/hubOrderProceeds';
import { findHubArchiveOrderById } from '../services/ebayHubArchiveIndex';
import { saleProceedsFromItemFields } from '../utils/saleProceeds';

const EPS = 0.02;

function loadLiveDump(): { items: InventoryItem[]; orders: EbayOrderRecord[] } {
  const dumpPath = path.join(process.cwd(), 'scripts', 'output', 'live-hub-audit.json');
  if (!fs.existsSync(dumpPath)) {
    throw new Error('Missing scripts/output/live-hub-audit.json');
  }
  return JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
}

function orderKey(id: string): string {
  return id.trim().toLowerCase().replace(/[\s_]/g, '');
}

function money(n: number | null | undefined): number {
  return n != null && Number.isFinite(n) ? roundMoney(n) : 0;
}

/** Rows that need Hub re-apply: replace plan + split diffs on roots not already covered. */
export function buildHubSellHealPlan(
  items: InventoryItem[],
  orders: EbayOrderRecord[],
  taxMode = POCKET_PROFIT_TAX_MODE
): HubBreakdownReplaceRow[] {
  const byOrder = new Map(orders.map((o) => [orderKey(o.orderId), o]));
  const fromPlan = buildHubBreakdownReplacePlan(items, orders, taxMode);
  const seen = new Set(fromPlan.map((r) => r.itemId));
  const extra: HubBreakdownReplaceRow[] = [];

  for (const item of items) {
    if (item.status !== ItemStatus.SOLD && item.status !== ItemStatus.TRADED) continue;
    if (shouldSkipHubPlanForContainerChild(item, items)) continue;
    if (seen.has(item.id)) continue;

    const oid = hubOrderIdFromItem(item);
    if (!oid) continue;
    const order = byOrder.get(orderKey(oid));
    if (!order) continue;

    const hubSplit = hubSaleColumnSplitForItem(order, item, items);
    if (!hubSellSplitDiffersFromItem(item, hubSplit)) continue;

    const row = buildHubApplyRowForItem(item, order, taxMode, items, 'differs');
    const cur = saleProceedsFromItemFields(item);
    const next = saleProceedsFromItemFields(row.nextItem);
    const netMoved =
      row.before.net != null &&
      row.after.net != null &&
      Math.abs(row.before.net - row.after.net) >= EPS;
    const totalMoved =
      row.before.total != null &&
      row.after.total != null &&
      Math.abs(row.before.total - row.after.total) >= EPS;
    const feesMoved =
      Math.abs(money(cur.transactionFeeEur) - money(next.transactionFeeEur)) >= EPS ||
      Math.abs(money(cur.adFeeEur) - money(next.adFeeEur)) >= EPS ||
      Math.abs(money(cur.shippingLabelEur) - money(next.shippingLabelEur)) >= EPS;

    if (netMoved || totalMoved || feesMoved || cur.source !== 'ebay_seller_hub') {
      extra.push(row);
      seen.add(item.id);
    }
  }

  return [...fromPlan, ...extra];
}

/** Sync sellPrice when it drifted from saleProceeds.buyerTotalEur. */
export function buildSellPriceSyncPatches(items: InventoryItem[]): InventoryItem[] {
  const patches: InventoryItem[] = [];
  for (const item of items) {
    if (item.status !== ItemStatus.SOLD && item.status !== ItemStatus.TRADED) continue;
    const buyer = item.saleProceeds?.buyerTotalEur;
    if (buyer == null || !Number.isFinite(buyer)) continue;
    if (item.sellPrice == null || Math.abs(Number(item.sellPrice) - buyer) < EPS) continue;
    patches.push({ ...item, sellPrice: roundMoney(buyer) });
  }
  return patches;
}

export function applyHubSellHeal(
  items: InventoryItem[],
  orders: EbayOrderRecord[],
  taxMode = POCKET_PROFIT_TAX_MODE
): { items: InventoryItem[]; plan: HubBreakdownReplaceRow[]; patchedIds: string[] } {
  const plan = buildHubSellHealPlan(items, orders, taxMode);
  let next = applyHubBreakdownReplacePlan(items, plan);

  for (const row of plan) {
    const idx = next.findIndex((i) => i.id === row.itemId);
    if (idx >= 0) {
      next[idx] = { ...row.nextItem, profit: computeSoldTabMargin(row.nextItem) };
    }
  }

  const planIds = new Set(plan.map((r) => r.itemId));
  const priceSync = buildSellPriceSyncPatches(next).filter((p) => !planIds.has(p.id));
  if (priceSync.length) {
    const byId = new Map(next.map((i) => [i.id, i]));
    for (const p of priceSync) {
      const synced = { ...p, profit: computeSoldTabMargin(p) };
      byId.set(p.id, synced);
    }
    next = [...byId.values()];
  }

  const profitHeal = healRealizedProfitsFromSaleProceeds(next).filter(
    (p) => !planIds.has(p.id)
  );
  if (profitHeal.length) {
    const byId = new Map(next.map((i) => [i.id, i]));
    for (const p of profitHeal) byId.set(p.id, p);
    next = [...byId.values()];
  }

  const patchedIds = [
    ...new Set([
      ...plan.map((r) => r.itemId),
      ...priceSync.map((p) => p.id),
      ...profitHeal.map((p) => p.id),
    ]),
  ];

  return { items: next, plan, patchedIds };
}

function summarizePlan(plan: HubBreakdownReplaceRow[]) {
  const netFixes = plan.filter(
    (r) =>
      r.after.net != null &&
      r.before.net != null &&
      Math.abs(r.before.net - r.after.net) >= EPS
  );
  const hubWrong = plan.filter(
    (r) => r.before.source === 'ebay_seller_hub' && netFixes.some((n) => n.itemId === r.itemId)
  );
  return { total: plan.length, netFixes: netFixes.length, hubWrong: hubWrong.length, netFixesRows: netFixes };
}

function itemFinancialChanged(before: InventoryItem, after: InventoryItem): boolean {
  const b = saleProceedsFromItemFields(before);
  const a = saleProceedsFromItemFields(after);
  return (
    Math.abs(money(b.netPayoutEur) - money(a.netPayoutEur)) >= EPS ||
    Math.abs(money(b.buyerTotalEur) - money(a.buyerTotalEur)) >= EPS ||
    Math.abs(money(b.transactionFeeEur) - money(a.transactionFeeEur)) >= EPS ||
    Math.abs(money(b.adFeeEur) - money(a.adFeeEur)) >= EPS ||
    Math.abs(money(b.shippingLabelEur) - money(a.shippingLabelEur)) >= EPS ||
    Math.abs(money(before.sellPrice) - money(after.sellPrice)) >= EPS ||
    Math.abs(money(before.profit) - money(after.profit)) >= EPS
  );
}

async function applyViaCdp(patches: InventoryItem[]): Promise<void> {
  const { chromium } = await import('playwright');
  const cdpUrl = process.env.CDP_URL || 'http://127.0.0.1:9222';
  const appPort = process.env.VITE_PORT || '5173';
  const appUrl = `http://127.0.0.1:${appPort}/`;

  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const ctx = browser.contexts()[0];
    if (!ctx) throw new Error('No browser context on CDP');

    let page = ctx.pages().find((p) => /localhost:\d+/.test(p.url()) && !p.isClosed());
    if (!page) {
      page = await ctx.newPage();
      await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(3000);
    }

    const patchJson = JSON.stringify(patches);
    const result = await page.evaluate(`(function(patches) {
      const raw = localStorage.getItem('inventory_items');
      if (!raw) return { ok: false, error: 'no inventory_items in localStorage' };
      const items = JSON.parse(raw);
      const byId = new Map(items.map(function(i) { return [i.id, i]; }));
      var applied = 0;
      for (var pi = 0; pi < patches.length; pi++) {
        var p = patches[pi];
        if (byId.has(p.id)) { byId.set(p.id, p); applied++; }
      }
      var merged = items.map(function(i) { return byId.get(i.id) || i; });
      localStorage.setItem('inventory_items', JSON.stringify(merged));
      window.dispatchEvent(new Event('storage'));
      window.dispatchEvent(new CustomEvent('inventory-local-heal', { detail: { count: applied } }));
      return { ok: true, applied: applied, total: items.length };
    })(${patchJson})`);

    console.log('CDP apply result:', result);
    if (!result?.ok) throw new Error(result?.error || 'CDP apply failed');
  } finally {
    await browser.close().catch(() => {});
  }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('fix-hub-sell-from-archive.ts')) {
  const apply = process.argv.includes('--apply');
  const healMargins = process.argv.includes('--heal-margins');
  const { items, orders } = loadLiveDump();
  const { items: fixed, plan, patchedIds } = applyHubSellHeal(items, orders);
  const summary = summarizePlan(plan);

  const hubPatchIds = new Set(plan.map((r) => r.itemId));
  const marginHealIds = patchedIds.filter((id) => !hubPatchIds.has(id));

  const hubChanged = plan
    .map((row) => {
      const before = items.find((i) => i.id === row.itemId)!;
      const after = fixed.find((i) => i.id === row.itemId)!;
      return {
        id: row.itemId,
        name: before.name,
        orderId: row.orderId,
        reason: row.reason,
        beforeNet: row.before.net,
        afterNet: row.after.net,
        beforeProfit: row.before.profit,
        afterProfit: row.after.profit,
        beforeSell: row.before.sell,
        afterSell: row.after.sell,
        before,
        after,
      };
    })
    .filter((c) => itemFinancialChanged(c.before, c.after));

  const marginChanged = marginHealIds
    .map((id) => {
      const before = items.find((i) => i.id === id)!;
      const after = fixed.find((i) => i.id === id)!;
      return {
        id,
        name: before.name,
        orderId: hubOrderIdFromItem(before),
        beforeProfit: before.profit ?? null,
        afterProfit: after.profit ?? null,
        before,
        after,
      };
    })
    .filter(
      (c) =>
        c.beforeProfit != null &&
        c.afterProfit != null &&
        Math.abs(c.beforeProfit - c.afterProfit) >= EPS
    );

  const outDir = path.join(process.cwd(), 'scripts', 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const hubPatches = hubChanged.map((c) => fixed.find((i) => i.id === c.id)!);
  const marginPatches = marginChanged.map((c) => fixed.find((i) => i.id === c.id)!);
  fs.writeFileSync(
    path.join(outDir, 'hub-sell-fix-patches.json'),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        summary,
        hubChanged,
        marginChanged: marginChanged.length,
        hubPatches,
        marginPatches,
      },
      null,
      2
    )
  );

  console.log('Hub sell heal plan:', summary.total, 'rows');
  console.log('Net corrections:', summary.netFixes, '(previously hub-stamped:', summary.hubWrong, ')');
  console.log('Hub financial rows to patch:', hubChanged.length);
  console.log('Margin-only heal rows:', marginChanged.length);

  for (const c of hubChanged) {
    const netD =
      c.beforeNet != null && c.afterNet != null
        ? roundMoney(c.afterNet - c.beforeNet)
        : null;
    console.log(
      `  ${c.orderId || '?'} · ${c.name.slice(0, 52)} · ${c.reason}` +
        (netD != null && Math.abs(netD) >= EPS ? ` · net Δ ${netD}` : '') +
        (c.beforeProfit != null && c.afterProfit != null && Math.abs(c.beforeProfit - c.afterProfit) >= EPS
          ? ` · margin ${c.beforeProfit} → ${c.afterProfit}`
          : '')
    );
  }

  const toApply = healMargins ? [...hubPatches, ...marginPatches] : hubPatches;

  const { items: fixed } = applyHubSellHeal(items, orders);
  fs.writeFileSync(
    path.join(outDir, 'inventory-items-healed.json'),
    JSON.stringify(fixed, null, 0)
  );

  if (apply && toApply.length) {
    console.log('\nApplying', toApply.length, 'patches via CDP…');
    await applyViaCdp(toApply);
    console.log('Done — hard-refresh the app and check Dashboard.');
  } else if (hubPatches.length) {
    console.log('\nDry run. Re-run with --apply to patch Hub sell rows via CDP.');
    if (marginChanged.length) {
      console.log(`Add --heal-margins to also fix ${marginChanged.length} stale margin values.`);
    }
  }

  process.exit(hubChanged.length ? 1 : 0);
}
