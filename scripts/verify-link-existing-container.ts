import { ItemStatus, type InventoryItem } from '../types';
import { linkExistingContainerToEbayTx } from '../utils/linkInventoryItemToEbayTx';
import type { EbayTxRow, EbayTxOrderLedger } from '../utils/ebayTransactionReport';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const children: InventoryItem[] = [
  { id: 'c1', name: 'CPU', buyPrice: 40, buyDate: '2025-01-01', category: 'Components', status: ItemStatus.IN_COMPOSITION, parentContainerId: 'b1', comment1: '', comment2: '' },
  { id: 'c2', name: 'RAM', buyPrice: 20, buyDate: '2025-01-01', category: 'Components', status: ItemStatus.IN_COMPOSITION, parentContainerId: 'b1', comment1: '', comment2: '' },
];
const bundle: InventoryItem = {
  id: 'b1', name: 'PC Bundle', buyPrice: 60, buyDate: '2025-01-01', category: 'PC', status: ItemStatus.IN_STOCK,
  isPC: true, componentIds: ['c1','c2'], comment1: '', comment2: '',
};
const row: EbayTxRow = {
  id: 'tx1', kind: 'order', typeRaw: 'Bestellung', orderId: '11-11111-11111', title: 'PC Bundle',
  createdSort: '2025-02-27', createdAt: '27.02.2025', itemSubtotalEur: 100, shippingEur: 6.19, grossEur: 106.19, netEur: 90,
};
const ledger: EbayTxOrderLedger = {
  orderId: '11-11111-11111', itemEur: 100, buyerShipEur: 6.19, fvfEur: -5, adsEur: 0, labelEur: -6.19, otherEur: 0, grossEur: 106.19, orderNetEur: 95, pocketEur: 90,
};
const result = linkExistingContainerToEbayTx(bundle, children, row, ledger, 'SmallBusiness');
assert(result, 'result');
const shell = result.updates.find((u) => u.id === 'b1')!;
const parts = result.updates.filter((u) => u.id !== 'b1');
assert(shell.sellDate === '2025-02-27', `shell date ${shell.sellDate}`);
assert(shell.ebayOrderId === '11-11111-11111', 'shell order');
assert(Math.abs((shell.sellPrice || 0) - 106.19) < 0.02, `shell sell ${shell.sellPrice}`);
assert(parts.length === 2, '2 parts');
assert(parts.every((p) => p.sellDate === '2025-02-27'), 'part dates');
const sum = parts.reduce((s, p) => s + (Number(p.sellPrice) || 0), 0);
assert(Math.abs(sum - 106.19) < 0.02, `split sum ${sum}`);
assert(parts.every((p) => p.ebayOrderId === '11-11111-11111'), 'part order meta');
console.log('verify-link-existing-container: ok', { perPart: parts.map((p) => p.sellPrice), shellDate: shell.sellDate });
