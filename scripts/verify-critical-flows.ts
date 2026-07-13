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
import { classifyTransactionType, sumFinancialEventNet, getOrderEffectiveNet, isOrderFullyRefunded, sumOrderSaleProceeds } from '../utils/ebayOrderFinancial';
import {
  applyEbaySaleAdjustmentToItem,
  buildAdjustmentFromEvent,
  getOriginalSellPrice,
  sumAdjustmentAmounts,
} from '../utils/ebaySaleAdjustments';
import type { EbayOrderFinancialEvent, EbayOrderRecord } from '../services/ebayOrderIndex';
import { isRealizedDisposal, dispositionDate } from '../utils/itemDisposition';
import { parseEbayOrderCsv } from '../services/ebayOrderCsvImport';
import {
  findSpoolByEbayLineKey,
  addFilamentSpool,
  getRemainingGrams,
  getUsedGrams,
  recordFilamentUsage,
  setRemainingOverride,
  type FilamentStockState,
} from '../services/filamentStock';
import { calculateTaxSummary } from '../services/taxService';
import { FILAMENT_STOCK_EXPENSE_CATEGORY, isOperatingExpense } from '../utils/expenseCategories';
import type { Expense } from '../types';

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
  assertClose(applied.profit!, 30, 'ebay apply profit: net sell 80 - buy 50 (fee already in net)');
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
  assert(soldRow?.Effektiver_VK_EUR === 430, 'finanzamt effective sell price');

  const withAdj = baseItem({
    id: 'fa-adj',
    name: 'Adjusted GPU',
    status: ItemStatus.SOLD,
    sellPrice: 65,
    originalSellPrice: 85,
    sellDate: '2025-07-01',
    profit: 15,
    ebayOrderId: 'ORD-1',
    ebaySaleAdjustments: [
      {
        id: 'a1',
        eventId: 'e2',
        date: '2025-07-08',
        kind: 'refund',
        amount: -20,
        orderId: 'ORD-1',
        reason: 'eBay refund',
        source: 'ebay_csv',
        importedAt: '',
        sellPriceBefore: 85,
        sellPriceAfter: 65,
      },
    ],
  });
  const adjRows = buildFinanzamtWareRows([withAdj]);
  assert(adjRows[0].Ursprünglicher_VK_EUR === 85, 'finanzamt original VK');
  assert(adjRows[0].Korrektur_Summe_EUR === -20, 'finanzamt correction sum');
  assert(adjRows[0].eBay_Bestellnr === 'ORD-1', 'finanzamt order id');
  assert(adjRows[0].Korrektur_Nachweis.includes('eBay refund'), 'finanzamt adjustment note');
}

function runCsvImportTests(): void {
  const csv = [
    'Order Number,Custom label,Item title,Sold For,Net amount,Final Value Fee,Sale Date,Transaction type',
    'ORD-CSV-1,SKU-X,Test GPU,100.00,85.00,15.00,2025-07-01,Order',
    'ORD-CSV-1,SKU-X,Test GPU refund,,-20.00,3.00,2025-07-08,Refund',
  ].join('\n');
  const parsed = parseEbayOrderCsv(csv);
  assert(parsed.orders.length === 1, 'groups csv by order id');
  assert(parsed.orders[0].lineItems.length >= 1, 'keeps sale line item');
  assert((parsed.orders[0].financialEvents?.length || 0) >= 2, 'stores sale + refund events');
  assertClose(parsed.orders[0].netTotal ?? 0, 65, 'order net = sale + refund');

  const deReport = [
    '--,--,--',
    'Transaktionsbericht',
    'Datum der Transaktionserstellung;Typ;Bestellnummer;Nutzername des Käufers;Name des Käufers;Versandziel - Ort;Versandziel - PLZ;Versandziel - Land;Betrag abzügl. Kosten;Artikelnr.;Angebotstitel;Bestandseinheit;Stückzahl;Zwischensumme Artikel;Verpackung und Versand;Transaktionsbetrag (inkl. Kosten);Beschreibung',
    '"Dez 29, 2025";Bestellung;08-14033-47175;kanyenord;Benjamin Imamovic;Bremen;28357;DE;"23,65";267458796006;2× Corsair AR120 Lüfter;SKU-1;1;"19,9";"6,19";"26,09";--',
    '"Dez 29, 2025";Andere Gebühr;08-14033-47175;kanyenord;Benjamin Imamovic;--;--;--;"-2,14";267458796006;--;--;--;--;--;--;Promoted Listings fee',
  ].join('\n');
  const deParsed = parseEbayOrderCsv(deReport);
  assert(deParsed.orders.length === 1, 'parses eBay.de Transaktionsbericht');
  assert(deParsed.orders[0].orderId === '08-14033-47175', 'de report order id');
  assert(deParsed.orders[0].lineItems.length >= 1, 'de report line item');
  assert(deParsed.orders[0].buyer.username === 'kanyenord', 'de report buyer');
  assert((deParsed.orders[0].financialEvents?.length || 0) >= 2, 'de report sale + fee events');
  assert(deParsed.orders[0].netTotal != null, 'de report has net total');

  const saleOnlyOrder = {
    orderId: 'ORD-SALE-NET',
    creationDate: '2025-08-11',
    buyer: { username: 'buyer' },
    lineItems: [{ sku: null, title: 'GPU', lineItemCost: 57.6 }],
    grossTotal: 65.29,
    netTotal: 42.03,
    financialEvents: [
      { id: 's1', date: '2025-08-11', kind: 'sale' as const, amount: 59.82, grossAmount: 65.29, source: 'csv' as const, importedAt: '' },
      { id: 'f1', date: '2025-08-11', kind: 'fee' as const, amount: -10.1, source: 'csv' as const, importedAt: '' },
      { id: 'l1', date: '2025-08-12', kind: 'fee' as const, amount: -7.69, transactionType: 'Versandetikett', description: 'DHL', source: 'csv' as const, importedAt: '' },
    ],
    sources: ['csv' as const],
    importedAt: '',
  };
  const salePayout = getLinePayout(saleOnlyOrder, saleOnlyOrder.lineItems[0]);
  assertClose(salePayout.sellPrice, 42.03, 'net = order proceeds minus fees and shipping label');
  assertClose(salePayout.fee, 17.79, 'fees include promoted + shipping label');
  assert(salePayout.netKnown === true, 'order net known');

  const corsairOrder = {
    orderId: '15-13186-47065',
    creationDate: '2025-06-12',
    buyer: { username: 'ccjon-46', fullName: 'Jonas Meyer' },
    lineItems: [{ sku: null, title: 'Corsair RAM', lineItemCost: 26.99, listingId: '267283009195' }],
    grossTotal: 33.18,
    netTotal: 22.33,
    financialEvents: [
      {
        id: 'f-promo',
        date: '2025-06-12',
        kind: 'fee' as const,
        amount: -4.66,
        transactionType: 'Andere Gebühr',
        description: 'Promoted Listings - General fee',
        source: 'csv' as const,
        importedAt: '',
      },
      {
        id: 'f-ship',
        date: '2025-06-12',
        kind: 'fee' as const,
        amount: -6.19,
        transactionType: 'Versandetikett',
        description: 'DHL',
        source: 'csv' as const,
        importedAt: '',
      },
      {
        id: 'sale',
        date: '2025-06-12',
        kind: 'sale' as const,
        amount: 33.18,
        transactionType: 'Bestellung',
        source: 'csv' as const,
        importedAt: '',
      },
    ],
    sources: ['csv' as const],
    importedAt: '',
  };
  const corsairPayout = getLinePayout(corsairOrder, corsairOrder.lineItems[0]);
  assertClose(corsairPayout.gross ?? 0, 26.99, 'item gross excludes buyer shipping');
  assertClose(corsairPayout.sellPrice, 22.33, 'Bestelleinnahmen after ads + shipping label');
  assert(classifyTransactionType('Versandetikett', -6.19, 'DHL') === 'fee', 'shipping label is fee not refund');

  const refundedGpu: EbayOrderRecord = {
    orderId: '26-14576-17166',
    creationDate: '2026-05-06',
    buyer: { username: 'dawiest123', fullName: 'Thomas Wiest' },
    lineItems: [{ sku: null, title: 'Nvidia Quadro P400 3x Mini DP 2GB GDDR5 Grafikkarte', lineItemCost: 20 }],
    grossTotal: 26.19,
    financialEvents: [
      { id: 'gpu-sale', date: '2026-05-06', kind: 'sale', amount: 23.63, transactionType: 'Bestellung', source: 'csv', importedAt: '' },
      { id: 'gpu-pl', date: '2026-05-06', kind: 'fee', amount: -3.74, transactionType: 'Andere Gebühr', description: 'Promoted Listings', source: 'csv', importedAt: '' },
      { id: 'gpu-dhl', date: '2026-05-06', kind: 'fee', amount: -6.19, transactionType: 'Versandetikett', description: 'DHL', source: 'csv', importedAt: '' },
      { id: 'gpu-ref', date: '2026-05-25', kind: 'return', amount: -24.17, transactionType: 'Rückerstattung', source: 'csv', importedAt: '' },
      { id: 'gpu-pl-cr', date: '2026-05-25', kind: 'fee', amount: 3.74, transactionType: 'Andere Gebühr', description: 'Promoted Listings credit', source: 'csv', importedAt: '' },
    ],
    sources: ['csv'],
    importedAt: '',
  };
  assertClose(getOrderEffectiveNet(refundedGpu)!, -6.73, 'refunded GPU order net Bestelleinnahmen');
  assert(isOrderFullyRefunded(refundedGpu), 'GPU order detected as fully refunded');
  assertClose(sumOrderSaleProceeds(refundedGpu)!, 23.63, 'initial sale proceeds before refund');
  const gpuPayout = getLinePayout(refundedGpu, refundedGpu.lineItems[0]);
  assertClose(gpuPayout.sellPrice, -6.73, 'GPU sell price is signed net after refund');
  const gpuItem = baseItem({ id: 'gpu-1', buyPrice: 10, status: ItemStatus.IN_STOCK });
  const gpuApplied = applyEbayOrderMatchToItem(
    gpuItem,
    { order: refundedGpu, lineItem: refundedGpu.lineItems[0], matchScore: 500, matchKind: 'title' },
    'SmallBusiness'
  );
  assertClose(gpuApplied.sellPrice!, -6.73, 'apply match uses net after refund');
  assertClose(gpuApplied.originalSellPrice!, 23.63, 'preserves pre-refund sale proceeds');
  assertClose(gpuApplied.profit!, -16.73, 'profit = net payout minus buy price');
  assert(gpuApplied.feeAmount === 0, 'no separate fee when net known from CSV');
}

function runAdjustmentTests(): void {
  assert(classifyTransactionType('Refund', -20) === 'return', 'classifies negative refund as return');
  assert(classifyTransactionType('Storniert', null) === 'cancellation', 'classifies cancellation');

  const events: EbayOrderFinancialEvent[] = [
    { id: 'e1', date: '2025-07-01', kind: 'sale', amount: 85, source: 'csv', importedAt: '' },
    { id: 'e2', date: '2025-07-08', kind: 'refund', amount: -20, source: 'csv', importedAt: '' },
  ];
  assertClose(sumFinancialEventNet(events)!, 65, 'sums signed event net');

  const sold = baseItem({
    id: 'adj-1',
    status: ItemStatus.SOLD,
    sellPrice: 85,
    originalSellPrice: 85,
    ebayOrderId: 'ORD-ADJ',
    platformSold: 'ebay.de',
  });
  const refundEvent = events[1];
  const adjustment = buildAdjustmentFromEvent(sold, refundEvent, 'ORD-ADJ');
  assert(adjustment != null, 'builds adjustment from refund event');
  if (adjustment) {
    const next = applyEbaySaleAdjustmentToItem(sold, adjustment, 'SmallBusiness');
    assertClose(next.sellPrice!, 65, 'effective sell after refund');
    assert(next.originalSellPrice === 85, 'preserves original sell price');
    assert((next.ebaySaleAdjustments?.length || 0) === 1, 'stores adjustment audit row');
    assertClose(sumAdjustmentAmounts(next), -20, 'adjustment sum');
  }

  const order: EbayOrderRecord = {
    orderId: 'ORD-ADJ',
    creationDate: '2025-07-01',
    buyer: { username: 'b' },
    lineItems: [{ sku: 'SKU-X', title: 'GPU', lineItemCost: 100 }],
    grossTotal: 100,
    netTotal: 65,
    financialEvents: events,
    sources: ['csv'],
    importedAt: new Date().toISOString(),
  };
  const linked = baseItem({
    id: 'adj-1',
    ebaySku: 'SKU-X',
    ebayOrderId: 'ORD-ADJ',
    status: ItemStatus.SOLD,
    sellPrice: 85,
    originalSellPrice: 85,
    platformSold: 'ebay.de',
  });
  const analysis = buildOrderLinkAnalysis([linked], [order]);
  assert(analysis.stats.adjustmentCandidates >= 1, 'suggests refund adjustment');
  assert(analysis.suggestions.some((s) => s.kind === 'adjustment'), 'adjustment suggestion kind');
}

function runFilamentStockTests(): void {
  let state: FilamentStockState = { spools: [], updatedAt: new Date().toISOString() };
  state = addFilamentSpool(state, {
    type: 'PLA',
    color: 'White',
    pricePerKg: 20,
    purchasedGrams: 1000,
    source: 'amazon',
    vendor: 'Amazon',
  });
  const spool = state.spools[0];
  assert(spool.purchasedGrams === 1000, 'spool purchased grams');
  assert(getRemainingGrams(spool) === 1000, 'full spool remaining initially');

  const used = recordFilamentUsage(state, spool.id, 150, {
    kind: 'print',
    inventoryItemName: 'Bracket',
  });
  assert(!used.error, 'print usage records');
  assert(getUsedGrams(used.state.spools[0]) === 150, 'used grams after print');
  assert(getRemainingGrams(used.state.spools[0]) === 850, 'remaining after print');

  const blocked = recordFilamentUsage(used.state, spool.id, 900, { kind: 'print' });
  assert(!!blocked.error, 'blocks over-deduction');

  const adjusted = setRemainingOverride(used.state, spool.id, 500, 'weighed');
  assert(getRemainingGrams(adjusted.spools[0]) === 500, 'manual remaining override');

  let dupState: FilamentStockState = { spools: [], updatedAt: new Date().toISOString() };
  dupState = addFilamentSpool(dupState, {
    type: 'PLA',
    color: 'Red',
    pricePerKg: 18,
    purchasedGrams: 1000,
    source: 'ebay',
    ebayLineKey: 'order-1-tx-1',
  });
  let dupBlocked = false;
  try {
    addFilamentSpool(dupState, {
      type: 'PLA',
      color: 'Red',
      pricePerKg: 18,
      purchasedGrams: 1000,
      source: 'ebay',
      ebayLineKey: 'order-1-tx-1',
    });
  } catch {
    dupBlocked = true;
  }
  assert(dupBlocked, 'blocks duplicate ebay line spool');
  assert(!!findSpoolByEbayLineKey('order-1-tx-1', dupState), 'find spool by ebay line');
}

function runFilamentExpenseTaxTests(): void {
  assert(isOperatingExpense('Shipping') === true, 'shipping is operating');
  assert(isOperatingExpense(FILAMENT_STOCK_EXPENSE_CATEGORY) === false, 'filament stock not operating');
  const year = 2026;
  const expenses: Expense[] = [
    { id: 'e1', description: 'DHL', amount: 50, date: '2026-03-01', category: 'Shipping' },
    { id: 'e2', description: 'PLA spool', amount: 20, date: '2026-03-02', category: FILAMENT_STOCK_EXPENSE_CATEGORY },
  ];
  const summary = calculateTaxSummary([], expenses, year);
  assertClose(summary.expenses, 50, 'tax summary excludes filament stock from operating');

  const printItem = baseItem({
    id: 'print-1',
    name: 'Bracket',
    buyPrice: 2.5,
    buyDate: '2026-04-01',
    status: ItemStatus.IN_STOCK,
    specs: { 'Production Method': '3D Printed', 'Filament Weight': '100g' },
  });
  const withPrint = calculateTaxSummary([printItem], expenses, year);
  assertClose(withPrint.cogs, 2.5, 'print wareneingang from item buyPrice only');
  assertClose(withPrint.expenses, 50, 'filament stock purchase still not operating');
  assertClose(withPrint.netProfit, -52.5, 'no double filament hit in EÜR (cogs yes, stock expense no)');
}

console.log('DeInventory critical-flow verification\n');

runTradeTests();
runSaleRevertTests();
runTradeActionHistoryTests();
runTradeAllocationTests();
runProfitTests();
runEbayPayoutTests();
runEbayAnalysisTests();
runAdjustmentTests();
runFinanzamtTests();
runCsvImportTests();
runFilamentStockTests();
runFilamentExpenseTaxTests();

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
console.log('All critical-flow checks passed.');
