import { ItemStatus, type InventoryItem } from '../types';
import { linkMultipleInventoryItemsToEbayTx, unlinkEbayTxOrderFromInventory } from '../utils/linkInventoryItemToEbayTx';
import type { EbayTxOrderLedger, EbayTxRow } from '../utils/ebayTransactionReport';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const row: EbayTxRow = {
  id: 'tx-1',
  kind: 'order',
  typeRaw: 'Bestellung',
  orderId: '12-34567-89012',
  title: 'GPU + RAM lot',
  createdAt: '01.02.2026',
  createdSort: '2026-02-01',
  itemSubtotalEur: 90,
  shippingEur: 0,
  grossEur: 90,
  netEur: 75,
  buyerUsername: 'buyer1',
};

const ledger: EbayTxOrderLedger = {
  orderId: '12-34567-89012',
  itemEur: 90,
  buyerShipEur: 0,
  grossEur: 90,
  fvfEur: -10,
  adsEur: -2,
  labelEur: -3,
  pocketEur: 75,
  otherEur: 0,
};

const partA: InventoryItem = {
  id: 'part-a',
  name: 'RTX 3080',
  buyPrice: 200,
  buyDate: '2025-11-01',
  category: 'Components',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  sellPrice: 45,
  sellDate: '2026-01-28',
};

const partB: InventoryItem = {
  id: 'part-b',
  name: '16GB RAM',
  buyPrice: 30,
  buyDate: '2025-11-01',
  category: 'Components',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  sellPrice: 45,
  sellDate: '2026-01-28',
};

const result = linkMultipleInventoryItemsToEbayTx([partA, partB], row, ledger, 'SmallBusiness');
assert(result, 'bundle link should succeed');
const { bundle, updates } = result!;
assert(bundle.isBundle && bundle.componentIds?.length === 2, 'bundle shell created');
assert(bundle.ebayOrderId === row.orderId, 'order on bundle');
assert(bundle.sellPrice === 90, 'full buyer total on bundle');

const childA = updates.find((item) => item.id === 'part-a');
const childB = updates.find((item) => item.id === 'part-b');
assert(childA?.parentContainerId === bundle.id, 'child A nested');
assert(childB?.parentContainerId === bundle.id, 'child B nested');
assert(childA?.sellPrice === 45 && childB?.sellPrice === 45, 'equal split 90/2');
assert(childA?.ebayOrderId === row.orderId && childB?.ebayOrderId === row.orderId, 'order cascaded');
assert(childA?.sellDate === '2026-02-01', 'csv sell date on parts');

const allLinked = [bundle, childA!, childB!];
const unlinked = unlinkEbayTxOrderFromInventory(allLinked, row.orderId, bundle);
assert(unlinked, 'bundle unlink should succeed');
assert(unlinked!.deleteIds?.includes(bundle.id), 'empty bundle shell removed');
assert(
  unlinked!.updates.every((item) => item.id !== bundle.id || item.ebayOrderId !== row.orderId),
  'order cleared from shell or shell deleted'
);
const restoredA = unlinked!.updates.find((item) => item.id === 'part-a');
const restoredB = unlinked!.updates.find((item) => item.id === 'part-b');
assert(restoredA?.status === ItemStatus.IN_STOCK, 'part A back in stock');
assert(restoredB?.status === ItemStatus.IN_STOCK, 'part B back in stock');
assert(!restoredA?.ebayOrderId && !restoredB?.ebayOrderId, 'order cleared on parts');
assert(!restoredA?.parentContainerId && !restoredB?.parentContainerId, 'parts detached from bundle');

console.log('verify-abrechnung-bundle-link: ok');
