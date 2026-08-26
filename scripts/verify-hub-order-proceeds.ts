/**
 * Hub line picking for multi-line orders + sold bundles.
 * Run: npx tsx scripts/verify-hub-order-proceeds.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import type { EbayOrderRecord } from '../services/ebayOrderIndex';
import {
  pickHubLinesForItem,
  saleProceedsFromOrderForItem,
  shouldSkipHubPlanForContainerChild,
} from '../utils/hubOrderProceeds';
import { lineItemClaimKey } from '../utils/ebayOrderLinkAnalysis';

const order: EbayOrderRecord = {
  orderId: '408-14793-62151',
  creationDate: '2024-06-19',
  buyer: { username: 'ropah-3038' },
  lineItems: [
    { sku: 'a', title: '120GB SSD SATA', lineItemCost: 24.37 },
    { sku: 'b', title: 'Samsung SSD 850 EVO 120GB', lineItemCost: 5.67 },
  ],
  grossTotal: 30.04,
  netTotal: 30.04,
  sources: ['hub'],
  importedAt: '2026-08-22T00:00:00.000Z',
  financialEvents: [
    {
      id: '1',
      date: '2024-06-19',
      kind: 'sale',
      amount: 30.04,
      transactionType: 'Bestellung',
      source: 'hub',
      importedAt: '2026-08-22T00:00:00.000Z',
    },
    {
      id: '2',
      date: '2024-06-19',
      kind: 'fee',
      amount: -1.2,
      transactionType: 'Transaktionsgebühren',
      source: 'hub',
      importedAt: '2026-08-22T00:00:00.000Z',
    },
    {
      id: '3',
      date: '2024-06-19',
      kind: 'fee',
      amount: -0.8,
      transactionType: 'Anzeigengebühr Basis',
      source: 'hub',
      importedAt: '2026-08-22T00:00:00.000Z',
    },
  ],
};

const bundle: InventoryItem = {
  id: 'b1',
  name: '2x 120GB Samsung SSD 840/850 EVO',
  buyPrice: 14.79,
  buyDate: '2024-06-01',
  sellDate: '2024-06-19',
  category: 'Mixed Bundle',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  isBundle: true,
  componentIds: ['p1', 'p2'],
  ebayOrderId: '408-14793-62151',
};

const p1: InventoryItem = {
  id: 'p1',
  name: '120GB SSD SATA',
  buyPrice: 12,
  buyDate: '2024-06-01',
  sellDate: '2024-06-19',
  sellPrice: 24.37,
  category: 'Components',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  parentContainerId: 'b1',
  ebayOrderId: '408-14793-62151',
};

const p2: InventoryItem = {
  id: 'p2',
  name: 'Samsung SSD 850 EVO 120GB',
  buyPrice: 2.79,
  buyDate: '2024-06-01',
  sellDate: '2024-06-19',
  sellPrice: 5.67,
  category: 'Components',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  parentContainerId: 'b1',
  ebayOrderId: '408-14793-62151',
};

const catalog = [bundle, p1, p2];
const lines = pickHubLinesForItem(order, bundle, catalog);
assert.equal(lines.length, 2, 'bundle should claim both checkout lines');

const proceeds = saleProceedsFromOrderForItem(order, bundle, catalog);
assert.equal(proceeds.buyerTotalEur, 30.04);
assert.equal(proceeds.netPayoutEur, 30.04, 'Bestelleinnahmen from Hub archive netTotal');

assert.equal(shouldSkipHubPlanForContainerChild(p1, catalog), true);
assert.equal(shouldSkipHubPlanForContainerChild(bundle, catalog), false);

{
  const bundleWithLineKey: InventoryItem = {
    ...bundle,
    ebayOrderLineKey: lineItemClaimKey(order.orderId, order.lineItems[0]),
    sellPrice: 24.37,
    saleProceeds: {
      capturedAt: '2026-08-22T00:00:00.000Z',
      source: 'ebay_seller_hub',
      buyerTotalEur: 24.37,
      netPayoutEur: 22.75,
      feesEstimated: false,
    },
  };
  const keyedLines = pickHubLinesForItem(order, bundleWithLineKey, catalog);
  assert.equal(keyedLines.length, 2, 'line key must not clip full bundle checkout');
  const keyedProceeds = saleProceedsFromOrderForItem(order, bundleWithLineKey, catalog);
  assert.equal(keyedProceeds.buyerTotalEur, 30.04);
  assert.equal(keyedProceeds.netPayoutEur, 30.04);
}

{
  // Mis-scraped archive: netTotal equals event sum but Bestellung row is already Bestelleinnahmen.
  const doubleDeductOrder: EbayOrderRecord = {
    orderId: '08-14793-62151',
    creationDate: '2026-06-19',
    buyer: { username: 'ropah-3038', fullName: 'Raphael Otto' },
    lineItems: [
      { sku: 'ssd-a', title: '120GB SSD SATA', lineItemCost: 24.37 },
      { sku: 'ssd-b', title: 'Samsung SSD 850 EVO 120GB', lineItemCost: 5.67 },
    ],
    grossTotal: 30.04,
    netTotal: 13.4,
    sources: ['hub'],
    importedAt: '2026-08-22T00:00:00.000Z',
    financialEvents: [
      {
        id: '1',
        date: '2026-06-19',
        kind: 'sale',
        amount: 30.04,
        transactionType: 'Bestellung',
        source: 'hub',
        importedAt: '2026-08-22T00:00:00.000Z',
      },
      {
        id: '2',
        date: '2026-06-19',
        kind: 'fee',
        amount: -1.2,
        transactionType: 'Transaktionsgebühren',
        source: 'hub',
        importedAt: '2026-08-22T00:00:00.000Z',
      },
      {
        id: '3',
        date: '2026-06-19',
        kind: 'fee',
        amount: -0.8,
        transactionType: 'Anzeigengebühr Basis',
        source: 'hub',
        importedAt: '2026-08-22T00:00:00.000Z',
      },
      {
        id: '4',
        date: '2026-06-19',
        kind: 'fee',
        amount: -14.64,
        transactionType: 'Versandetikett',
        source: 'hub',
        importedAt: '2026-08-22T00:00:00.000Z',
      },
    ],
  };
  const doubleDeductBundle: InventoryItem = {
    id: 'bundle-ssd-62151',
    name: '2x 120GB Samsung SSD 840/850 EVO',
    buyPrice: 14.79,
    buyDate: '2024-06-01',
    sellDate: '2026-06-19',
    category: 'Mixed Bundle',
    status: ItemStatus.SOLD,
    comment1: '',
    comment2: '',
    isBundle: true,
    componentIds: ['p1', 'p2'],
    ebayOrderId: '08-14793-62151',
    sellPrice: 30.04,
  };
  const doubleDeductParts = [
    { ...p1, id: 'p1', parentContainerId: 'bundle-ssd-62151' },
    { ...p2, id: 'p2', parentContainerId: 'bundle-ssd-62151' },
  ];
  const recovered = saleProceedsFromOrderForItem(doubleDeductOrder, doubleDeductBundle, [
    doubleDeductBundle,
    ...doubleDeductParts,
  ]);
  assert.equal(recovered.buyerTotalEur, 30.04);
  assert.equal(recovered.netPayoutEur, 30.04, 'Bestelleinnahmen wins over double-deducted event sum');
}

{
  const buyerTotalOrder: EbayOrderRecord = {
    orderId: '08-14793-62551',
    creationDate: '2026-06-19',
    buyer: { username: 'repo1-2058' },
    lineItems: [{ sku: 'pc', title: 'Gaming PC', lineItemCost: 330 }],
    grossTotal: 399.85,
    netTotal: 330.04,
    sources: ['hub'],
    importedAt: '2026-08-22T00:00:00.000Z',
    financialEvents: [
      {
        id: '1',
        date: '2026-06-19',
        kind: 'sale',
        amount: 399.85,
        transactionType: 'Bestellung',
        source: 'hub',
        importedAt: '2026-08-22T00:00:00.000Z',
      },
      {
        id: '2',
        date: '2026-06-19',
        kind: 'fee',
        amount: -69.81,
        transactionType: 'Transaktionsgebühren',
        source: 'hub',
        importedAt: '2026-08-22T00:00:00.000Z',
      },
    ],
  };
  const buyerTotalProceeds = saleProceedsFromOrderForItem(
    buyerTotalOrder,
    {
      id: 'pc-row',
      name: 'Gaming PC',
      buyPrice: 200,
      buyDate: '2024-06-01',
      sellDate: '2026-06-19',
      sellPrice: 399.85,
      category: 'PC',
      status: ItemStatus.SOLD,
      comment1: '',
      comment2: '',
      ebayOrderId: '08-14793-62551',
    },
    []
  );
  assert.equal(buyerTotalProceeds.netPayoutEur, 330.04, 'Gesamtbetrag checkout keeps event-derived net');
}

{
  // Real order shape: buyer paid €39.85, item subtotal €30.04, broken event net €17.79.
  const gesamtOrder: EbayOrderRecord = {
    orderId: '08-14793-62151',
    creationDate: '2026-06-19',
    buyer: { username: 'ropah-3038', fullName: 'Raphael Otto' },
    lineItems: [
      { sku: 'ssd-a', title: '120GB SSD SATA', lineItemCost: 24.37 },
      { sku: 'ssd-b', title: 'Samsung SSD 850 EVO 120GB', lineItemCost: 5.67 },
    ],
    grossTotal: 39.85,
    netTotal: 17.79,
    sources: ['hub'],
    importedAt: '2026-08-22T00:00:00.000Z',
    financialEvents: [
      {
        id: '1',
        date: '2026-06-19',
        kind: 'sale',
        amount: 39.85,
        transactionType: 'Bestellung',
        source: 'hub',
        importedAt: '2026-08-22T00:00:00.000Z',
      },
      {
        id: '2',
        date: '2026-06-19',
        kind: 'fee',
        amount: -1.2,
        transactionType: 'Transaktionsgebühren',
        source: 'hub',
        importedAt: '2026-08-22T00:00:00.000Z',
      },
      {
        id: '3',
        date: '2026-06-19',
        kind: 'fee',
        amount: -0.8,
        transactionType: 'Anzeigengebühr Basis',
        source: 'hub',
        importedAt: '2026-08-22T00:00:00.000Z',
      },
      {
        id: '4',
        date: '2026-06-19',
        kind: 'fee',
        amount: -6.19,
        transactionType: 'Versandetikett',
        source: 'hub',
        importedAt: '2026-08-22T00:00:00.000Z',
      },
      {
        id: '5',
        date: '2026-06-19',
        kind: 'fee',
        amount: -13.87,
        transactionType: 'Transaktionsgebühren',
        source: 'hub',
        importedAt: '2026-08-22T00:00:00.000Z',
      },
    ],
  };
  const gesamtBundle: InventoryItem = {
    id: 'bundle-gesamt',
    name: '2x 120GB Samsung SSD 840/850 EVO',
    buyPrice: 14.79,
    buyDate: '2024-06-01',
    sellDate: '2026-06-19',
    category: 'Mixed Bundle',
    status: ItemStatus.SOLD,
    comment1: '',
    comment2: '',
    isBundle: true,
    componentIds: ['p1', 'p2'],
    ebayOrderId: '08-14793-62151',
    sellPrice: 30.04,
  };
  const gesamtParts = [
    { ...p1, id: 'p1', parentContainerId: 'bundle-gesamt' },
    { ...p2, id: 'p2', parentContainerId: 'bundle-gesamt' },
  ];
  const gesamtProceeds = saleProceedsFromOrderForItem(gesamtOrder, gesamtBundle, [
    gesamtBundle,
    ...gesamtParts,
  ]);
  assert.equal(gesamtProceeds.buyerTotalEur, 39.85);
  assert.equal(gesamtProceeds.netPayoutEur, 30.04, 'Bestelleinnahmen = item subtotal, not event sum');
}

console.log('verify-hub-order-proceeds: ok');
