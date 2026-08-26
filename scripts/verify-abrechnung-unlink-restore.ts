import { ItemStatus, type InventoryItem, type ItemSaleCycle } from '../types';
import {
  planAbrechnungMistakenLinkHeals,
  recoverPriorAbrechnungSale,
  unlinkAbrechnungSaleAndRestorePrevious,
} from '../utils/itemSaleCycle';
import {
  linkInventoryItemToEbayTx,
  unlinkEbayTxOrderFromInventory,
} from '../utils/linkInventoryItemToEbayTx';
import type { EbayTxOrderLedger, EbayTxRow } from '../utils/ebayTransactionReport';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const priorCycle: ItemSaleCycle = {
  id: 'cycle-prior',
  closedAt: '2026-01-10T12:00:00.000Z',
  reason: 'manual_unsold',
  reasonLabel: 'Marked unsold — returned to stock',
  sellDate: '2026-01-05',
  sellPrice: 120,
  profit: 80,
  platformSold: 'ebay.de',
  paymentType: 'ebay.de',
  ebayOrderId: '11-11111-11111',
  ebayOrderLineKey: '11-11111-11111::line',
  customer: { name: 'Real Buyer', address: 'Berlin' },
};

const wrongLinkItem: InventoryItem = {
  id: 'item-gpu',
  name: 'RTX 4090',
  buyPrice: 40,
  buyDate: '2025-12-01',
  category: 'Components',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  sellPrice: 5,
  sellDate: '2026-02-01',
  ebayOrderId: '22-22222-22222',
  ebaySaleCycles: [priorCycle],
};

const restored = unlinkAbrechnungSaleAndRestorePrevious(wrongLinkItem, '22-22222-22222');
assert(restored?.restoredPreviousSale, 'should restore prior sale');
assert(restored?.item.sellPrice === 120, 'sell price restored');
assert(restored?.item.ebayOrderId === '11-11111-11111', 'order id restored');
assert(restored?.item.status === ItemStatus.SOLD, 'stays sold');
assert(!restored?.item.ebaySaleCycles?.length, 'wrong link must not become a sale cycle');

const inStockItem: InventoryItem = {
  id: 'item-fan',
  name: 'Case Fan',
  buyPrice: 2,
  buyDate: '2026-01-01',
  category: 'Components',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  sellPrice: 5,
  sellDate: '2026-02-01',
  ebayOrderId: '33-33333-33333',
};

const cleared = unlinkEbayTxOrderFromInventory([inStockItem], '33-33333-33333', inStockItem);
assert(cleared && !cleared.restoredPreviousSale, 'no prior cycle → no restore');
assert(cleared?.updates[0]?.status === ItemStatus.IN_STOCK, 'returns to stock');
assert(cleared?.updates[0]?.sellPrice == null, 'sell price cleared');

const fanWrongLink: InventoryItem = {
  id: 'item-fan-ph',
  name: 'Case Fan RGB',
  buyPrice: 2,
  buyDate: '2026-01-01',
  category: 'Components',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  sellPrice: 19.99,
  sellDate: '2026-02-15',
  ebayOrderId: '15-12965-76343',
  platformSold: 'ebay.de',
  paymentType: 'ebay.de',
  priceHistory: [
    {
      date: '2025-04-17T10:00:00.000Z',
      type: 'sell',
      price: 8.33,
      previousPrice: undefined,
    },
    {
      date: '2026-02-15T12:00:00.000Z',
      type: 'sell',
      price: 19.99,
      previousPrice: 8.33,
      delta: 11.66,
    },
  ],
};

const fanRestored = unlinkAbrechnungSaleAndRestorePrevious(fanWrongLink, '15-12965-76343');
assert(fanRestored?.restoredPreviousSale, 'price history → restore prior sale');
assert(fanRestored?.item.sellPrice === 8.33, 'prior sell price restored');
assert(fanRestored?.item.sellDate === '2025-04-17', 'prior sell date from price history');
assert(!fanRestored?.item.ebaySaleCycles?.length, 'no false sale cycle after unlink');

const fanBroken: InventoryItem = {
  ...fanWrongLink,
  status: ItemStatus.IN_STOCK,
  sellPrice: undefined,
  sellDate: undefined,
  ebayOrderId: undefined,
  comment2: '[Abrechnung unlink 15-12965-76343 2/15/2026]',
  ebaySaleCycles: [
    {
      id: 'cycle-wrong',
      closedAt: '2026-02-15T12:00:00.000Z',
      reason: 'manual_unsold',
      reasonLabel: 'Marked unsold — returned to stock',
      sellPrice: 19.99,
      sellDate: '2026-02-15',
      ebayOrderId: '15-12965-76343',
    },
  ],
};

const fanHealed = recoverPriorAbrechnungSale(fanBroken);
assert(fanHealed?.restoredPreviousSale, 'recover already-unlinked item');
assert(fanHealed?.item.sellPrice === 8.33, 'heal restores €8.33');
assert(fanHealed?.item.status === ItemStatus.SOLD, 'heal marks sold again');
assert(!fanHealed?.item.ebaySaleCycles?.length, 'bogus wrong-order cycle removed');

const fanScrubOnly: InventoryItem = {
  ...fanBroken,
  status: ItemStatus.SOLD,
  sellPrice: 8.33,
  sellDate: '2025-04-17',
  ebayOrderId: '01-11111-11111',
};

const fanScrubbed = recoverPriorAbrechnungSale(fanScrubOnly);
assert(fanScrubbed && !fanScrubbed.restoredPreviousSale, 'scrub-only when live sale already correct');
assert(!fanScrubbed?.item.ebaySaleCycles?.length, 'false history removed');

const fanAutoHeal = planAbrechnungMistakenLinkHeals([fanBroken]);
assert(fanAutoHeal.length === 1, 'auto-heal picks up broken fan row');
assert(!fanAutoHeal[0]?.ebaySaleCycles?.length, 'auto-heal clears false cycles');

const priorSold: InventoryItem = {
  id: 'item-fan-archive',
  name: 'Nzxt Fan',
  buyPrice: 3,
  buyDate: '2025-03-01',
  category: 'Components',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  sellPrice: 8.33,
  sellDate: '2025-04-17',
  ebayOrderId: '01-11111-11111',
  platformSold: 'ebay.de',
  paymentType: 'ebay.de',
};

const txRow: EbayTxRow = {
  id: 'tx-fan',
  kind: 'order',
  typeRaw: 'Bestellung',
  orderId: '15-12965-76343',
  title: 'Wrong order',
  createdAt: '15.02.2026',
  createdSort: '2026-02-15',
  itemSubtotalEur: 19.99,
  grossEur: 19.99,
  netEur: 17,
};

const ledger: EbayTxOrderLedger = {
  orderId: '15-12965-76343',
  itemEur: 19.99,
  buyerShipEur: 0,
  grossEur: 19.99,
  fvfEur: -2,
  adsEur: 0,
  labelEur: -1,
  pocketEur: 17,
  otherEur: 0,
};

const linked = linkInventoryItemToEbayTx(priorSold, txRow, ledger, 'SmallBusiness');
assert(linked.ebaySaleCycles?.length === 1, 'link archives prior sale');
assert(linked.ebaySaleCycles?.[0]?.sellPrice === 8.33, 'archived prior sell price');
assert(linked.ebaySaleCycles?.[0]?.sellDate === '2025-04-17', 'archived prior sell date');
assert(linked.sellPrice === 19.99, 'live sell overwritten by csv');

const relinkUndo = unlinkAbrechnungSaleAndRestorePrevious(linked, '15-12965-76343');
assert(relinkUndo?.item.sellPrice === 8.33, 'unlink restores archived prior sale');
assert(relinkUndo?.item.sellDate === '2025-04-17', 'unlink restores archived sell date');
assert(relinkUndo?.item.ebayOrderId === '01-11111-11111', 'unlink restores real order id');
assert(!relinkUndo?.item.ebaySaleCycles?.length, 'no false cycle after full round-trip');

// Matching a sold item that has sell fields but no eBay order must not invent a "Resold" cycle.
const soldNoOrder: InventoryItem = {
  id: 'item-sold-no-order',
  name: 'SSD 1TB',
  buyPrice: 40,
  buyDate: '2025-06-01',
  category: 'Components',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  sellPrice: 55,
  sellDate: '2026-03-01',
  platformSold: 'ebay.de',
  paymentType: 'ebay.de',
};
const matchedNoArchive = linkInventoryItemToEbayTx(soldNoOrder, txRow, ledger, 'SmallBusiness');
assert(matchedNoArchive.ebayOrderId === '15-12965-76343', 'csv order bound');
assert(matchedNoArchive.sellPrice === 19.99, 'csv sell applied');
assert(!matchedNoArchive.ebaySaleCycles?.length, 'no Resold cycle when there was no prior order id');

// Auto-heal must not wipe a good live Abrechnung link just because an empty prior cycle exists.
const goodLiveWithSpuriousCycle: InventoryItem = {
  ...matchedNoArchive,
  ebaySaleCycles: [
    {
      id: 'cycle-spurious',
      closedAt: '2026-03-01T12:00:00.000Z',
      reason: 'manual_unsold',
      reasonLabel: 'Marked unsold — returned to stock',
      sellPrice: 55,
      sellDate: '2026-03-01',
    },
  ],
};
const keepLive = planAbrechnungMistakenLinkHeals([goodLiveWithSpuriousCycle]);
assert(keepLive.length === 1, 'heal scrubs spurious empty-order cycle');
assert(keepLive[0]?.ebayOrderId === '15-12965-76343', 'heal keeps live Abrechnung order');
assert(!keepLive[0]?.ebaySaleCycles?.length, 'spurious Resold cycle removed');

console.log('verify-abrechnung-unlink-restore: ok');
