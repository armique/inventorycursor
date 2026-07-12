/**
 * Sandbox verification for tax-critical flows (trades, sales, eBay sync, gifts, Finanzamt).
 * Run: npm run verify
 */
import { ItemStatus, type InventoryItem, type ActionHistoryEntry } from '../types';
import { applyTradeRevert, stripTradeContextFromComment2 } from '../services/tradeRevert';
import { applySaleRevert } from '../services/saleRevert';
import { mergeTradeActionEntries } from '../services/tradeActionHistory';
import { allocateRemainderEuros } from '../services/tradeAllocation';
import { computeItemProfitBeforeOverhead, roundMoney } from '../services/financialAggregation';
import { buildFinanzamtWareRows } from '../services/finanzamtExportService';
import { calculateSaleProfit } from '../utils/saleProfit';
import { getLinePayout } from '../utils/ebayOrderPayout';
import { applyEbayOrderMatchToItem } from '../utils/applyEbayOrderMatch';
import { buildOrderLinkAnalysis } from '../utils/ebayOrderLinkAnalysis';
import { isRealizedDisposal, dispositionDate } from '../utils/itemDisposition';
import { parseEbayOrderCsv } from '../services/ebayOrderCsvImport';
import type { EbayOrderRecord } from '../services/ebayOrderIndex';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${message}`);
  }
}

function assertClose(actual: number, expected: number, message: string, eps = 0.011): void {
  assert(Math.abs(actual - expected) <= eps, `${message} (got ${actual}, expected ${expected})`);
}

function baseItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: overrides.id ?? 'item-1',
    name: overrides.name ?? 'RTX 4070',
    buyPrice: overrides.buyPrice ?? 400,
    buyDate: overrides.buyDate ?? '2025-06-01',
    status: overrides.status ?? ItemStatus.IN_STOCK,
    category: overrides.category ?? 'Components',
    subCategory: overrides.subCategory ?? 'GPU',
    comment1: overrides.comment1 ?? '',
    comment2: overrides.comment2 ?? '',
    ...overrides,
  };
}

function runTradeTests(): void {
  const outgoing = baseItem({
    id: 'out-1',
    name: 'My GPU',
    status: ItemStatus.TRADED,
    sellPrice: 500,
    sellDate: '2025-07-01',
    paymentType: 'Trade',
    tradedForIds: ['in-1'],
    comment2: 'note\n\n[Trade Context]: swapped at meetup',
  });
  const received = baseItem({
    id: 'in-1',
    name: 'RX 6800',
    buyPrice: 0,
    status: ItemStatus.IN_STOCK,
    tradedFromId: 'out-1',
  });

  const res = applyTradeRevert([outgoing, received], 'out-1', ['in-1'], 'SmallBusiness');
  assert(res.ok === true, 'trade revert succeeds');
  if (res.ok) {
    assert(res.removedIds.length === 1 && res.removedIds[0] === 'in-1', 'removes received item');
    assert(res.outgoingRestored.status === ItemStatus.IN_STOCK, 'outgoing back in stock');
    assert(res.outgoingRestored.sellPrice === undefined, 'clears sell price');
    assert(res.outgoingRestored.tradedForIds === undefined, 'clears tradedForIds');
    assert(res.outgoingRestored.comment2 === 'note', 'strips trade context from comment2');
    assert(res.nextItems.length === 1, 'one item left after revert');
  }

  const soldReceived = { ...received, status: ItemStatus.SOLD, sellPrice: 300 };
  const blocked = applyTradeRevert([outgoing, soldReceived], 'out-1', ['in-1'], 'SmallBusiness');
  assert(blocked.ok === false, 'blocks revert when received was sold later');

  const notTraded = baseItem({ id: 'x', status: ItemStatus.IN_STOCK });
  const blocked2 = applyTradeRevert([notTraded], 'x', [], 'SmallBusiness');
  assert(blocked2.ok === false, 'blocks revert when item not traded');

  assert(stripTradeContextFromComment2('a\n\n[Trade Context]: x') === 'a', 'stripTradeContextFromComment2');
}

function runSaleRevertTests(): void {
  const sold = baseItem({
    id: 's1',
    status: ItemStatus.SOLD,
    sellPrice: 450,
    sellDate: '2025-07-02',
    profit: 50,
    ebayOrderId: '12-345',
    platformSold: 'ebay.de',
    feeAmount: 45,
    hasFee: true,
    customer: { name: 'Buyer', address: 'Berlin' },
  });
  const next = applySaleRevert([sold], 's1')[0];
  assert(next.status === ItemStatus.IN_STOCK, 'sale revert to in stock');
  assert(next.sellPrice === undefined, 'clears sell price');
  assert(next.ebayOrderId === undefined, 'clears ebay order id');
  assert(next.profit === undefined, 'clears profit');
  assert(next.customer === undefined, 'clears customer');
}

function runTradeActionHistoryTests(): void {
  const traded = baseItem({
    id: 't-out',
    status: ItemStatus.TRADED,
    sellPrice: 600,
    sellDate: '2025-07-03',
    tradedForIds: ['t-in'],
    cashOnTop: 50,
  });
  const received = baseItem({ id: 't-in', tradedFromId: 't-out', name: 'PSU' });
  const noise: ActionHistoryEntry[] = [
    { id: '1', timestamp: new Date().toISOString(), action: 'Status changed: Traded', itemId: 't-out' },
    { id: '2', timestamp: new Date().toISOString(), action: 'Item created', itemId: 't-in' },
  ];
  const merged = mergeTradeActionEntries(noise, [traded, received]);
  assert(merged.length === 1, 'merges trade batch to one entry');
  assert(merged[0].action === 'Trade completed', 'trade completed action');
  assert(Array.isArray(merged[0].tradeReceivedIds) && merged[0].tradeReceivedIds![0] === 't-in', 'stores received ids');
  assert(merged[0].details?.includes('€600.00') === true, 'includes deal value in details');
  assert(merged[0].details?.includes('cash in') === true, 'includes cash direction');
}

function runTradeAllocationTests(): void {
  const items = [
    { id: 'a', name: 'A', category: 'Components' },
    { id: 'b', name: 'B', category: 'Components' },
    { id: 'c', name: 'C', category: 'Components' },
  ];
  const equal = allocateRemainderEuros(100, items, 'equal');
  const sum = roundMoney(equal.reduce((s, v) => s + v, 0));
  assertClose(sum, 100, 'equal split sums to remainder');
  assert(equal.every((v) => v > 0), 'equal split gives each item a share');

  const smart = allocateRemainderEuros(99.99, items, 'smart');
  const smartSum = roundMoney(smart.reduce((s, v) => s + v, 0));
  assertClose(smartSum, 99.99, 'smart split sums to remainder');
}

function runProfitTests(): void {
  assertClose(calculateSaleProfit(119, 50, 10, 'RegularVAT'), roundMoney(119 / 1.19 - 50 - 10), 'RegularVAT profit');
  assertClose(calculateSaleProfit(100, 40, 5, 'SmallBusiness'), 55, 'SmallBusiness profit');
  assertClose(calculateSaleProfit(80, 100, 0, 'DifferentialVAT'), -20, 'DifferentialVAT loss margin');

  const gifted = baseItem({
    status: ItemStatus.GIFTED,
    sellPrice: 200,
    buyPrice: 150,
    feeAmount: 0,
    hasFee: false,
  });
  assertClose(computeItemProfitBeforeOverhead(gifted, 'SmallBusiness'), 50, 'gift profit = market value - buy');
  assert(isRealizedDisposal(gifted), 'gift is realized disposal');
  assert(dispositionDate({ ...gifted, sellDate: '2025-07-04' }) === '2025-07-04', 'gift uses sellDate');
}

function runEbayPayoutTests(): void {
  const order: EbayOrderRecord = {
    orderId: 'ORD-1',
    creationDate: '2025-07-01',
    buyer: { username: 'buyer1' },
    lineItems: [
      { sku: 'SKU-A', title: 'GPU A', lineItemCost: 100 },
      { sku: 'SKU-B', title: 'GPU B', lineItemCost: 50 },
    ],
    grossTotal: 150,
    netTotal: 120,
    feeTotal: 30,
    sources: ['csv'],
    importedAt: new Date().toISOString(),
  };
  const lineA = order.lineItems[0];
  const payoutA = getLinePayout(order, lineA);
  assertClose(payoutA.sellPrice, 80, 'prorates net to line A (2/3 of 120)');
  assertClose(payoutA.fee, 20, 'prorates fee to line A');
  assert(payoutA.netKnown === true, 'net known from CSV');

  const item = baseItem({ ebaySku: 'SKU-A', buyPrice: 50 });
  const match = {
    order,
    lineItem: lineA,
    matchScore: 900,
    matchKind: 'sku' as const,
  };
  const applied = applyEbayOrderMatchToItem(item, match, 'SmallBusiness');
  assert(applied.status === ItemStatus.SOLD, 'ebay apply marks sold');
  assertClose(applied.sellPrice!, 80, 'ebay apply uses net payout');
  assertClose(applied.profit!, 10, 'ebay apply profit: net sell 80 - buy 50 - fee 20');
  assert(applied.ebayOrderId === 'ORD-1', 'links order id');
}

function runEbayAnalysisTests(): void {
  const order: EbayOrderRecord = {
    orderId: 'ORD-2',
    creationDate: '2025-07-05',
    buyer: { username: 'b2', fullName: 'Anna' },
    lineItems: [{ sku: 'GPU-99', title: 'RTX 4070 Super', lineItemCost: 500, listingId: '123' }],
    grossTotal: 500,
    netTotal: 430,
    feeTotal: 70,
    sources: ['csv'],
    importedAt: new Date().toISOString(),
  };

  const forgotten = baseItem({
    id: 'forgot',
    ebaySku: 'GPU-99',
    status: ItemStatus.IN_STOCK,
    buyPrice: 300,
  });
  const r1 = buildOrderLinkAnalysis([forgotten], [order]);
  assert(r1.stats.markSoldCandidates >= 1, 'detects forgotten sale');
  assert(r1.suggestions.some((s) => s.kind === 'mark_sold'), 'mark_sold suggestion');

  const unlinked = baseItem({
    id: 'unlink',
    ebaySku: 'GPU-99',
    status: ItemStatus.SOLD,
    sellPrice: 400,
    sellDate: '2025-07-05',
    platformSold: 'ebay.de',
  });
  const r2 = buildOrderLinkAnalysis([unlinked], [order]);
  assert(r2.suggestions.some((s) => s.kind === 'link'), 'link suggestion for unlinked sold');

  const linked = baseItem({
    id: 'linked',
    ebaySku: 'GPU-99',
    ebayOrderId: 'ORD-2',
    status: ItemStatus.SOLD,
    sellPrice: 400,
    sellDate: '2025-07-05',
    platformSold: 'ebay.de',
  });
  const r3 = buildOrderLinkAnalysis([linked], [order]);
  assert(r3.suggestions.some((s) => s.kind === 'reprice'), 'reprice when net payout differs');

  const keys = new Set(r1.suggestions.map((s) => s.id));
  assert(keys.size === r1.suggestions.length, 'no duplicate suggestion ids in mark_sold pass');
}

function runFinanzamtTests(): void {
  const items: InventoryItem[] = [
    baseItem({
      id: 'f1',
      status: ItemStatus.SOLD,
      sellPrice: 430,
      sellDate: '2025-07-01',
      profit: 130,
      feeAmount: 70,
      hasFee: true,
      platformSold: 'ebay.de',
    }),
    baseItem({
      id: 'f2',
      status: ItemStatus.GIFTED,
      sellPrice: 180,
      sellDate: '2025-07-02',
      profit: 30,
      buyPrice: 150,
    }),
    baseItem({
      id: 'f3',
      status: ItemStatus.TRADED,
      sellPrice: 500,
      sellDate: '2025-07-03',
      profit: 100,
      paymentType: 'Trade',
    }),
  ];
  const rows = buildFinanzamtWareRows(items);
  assert(rows.length === 3, 'finanzamt exports sold, gifted, traded');
  const soldRow = rows.find((r) => r.Bezeichnung === 'RTX 4070' && r.Status.includes('Verkauft'));
  assert(soldRow?.Verkaufspreis_EUR === 430, 'finanzamt sell price exact cents');
  assert(rows.some((r) => r.Status.includes('Verschenkt')), 'finanzamt includes gifted status');
}

function runCsvImportTests(): void {
  const csv = [
    'Order Number,Custom label,Item title,Sold For,Net amount,Final Value Fee,Sale Date',
    'ORD-CSV-1,SKU-X,Test GPU,100.00,85.00,15.00,2025-07-01',
    'ORD-CSV-1,SKU-X,Test GPU,-20.00,-17.00,3.00,2025-07-08',
  ].join('\n');
  const parsed = parseEbayOrderCsv(csv);
  assert(parsed.orders.length === 1, 'groups csv by order id');
  assert(parsed.orders[0].lineItems.length === 2, 'keeps multiple rows per order (refund line preserved)');
}

console.log('DeInventory critical-flow verification\n');

runTradeTests();
runSaleRevertTests();
runTradeActionHistoryTests();
runTradeAllocationTests();
runProfitTests();
runEbayPayoutTests();
runEbayAnalysisTests();
runFinanzamtTests();
runCsvImportTests();

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
console.log('All critical-flow checks passed.');
