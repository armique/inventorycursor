import { ItemStatus, type InventoryItem } from '../types';
import { saleColumnSplit, saleProceedsFromItemFields, saleProceedsRows } from '../utils/saleProceeds';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const item: InventoryItem = {
  id: 'integral',
  name: 'Integral 32GB',
  buyPrice: 20,
  buyDate: '2025-01-01',
  category: 'Components',
  status: ItemStatus.SOLD,
  sellPrice: 45.19,
  sellDate: '2025-02-27',
  feeAmount: 6.19,
  saleProceeds: {
    capturedAt: '2025-02-27T12:00:00.000Z',
    source: 'ebay_order',
    itemGrossEur: 39,
    buyerShippingEur: 6.19,
    buyerTotalEur: 45.19,
    transactionFeeEur: null,
    adFeeEur: null,
    shippingLabelEur: 6.19,
    otherFeeEur: null,
    refundEur: null,
    netPayoutEur: 39,
    feesEstimated: false,
  },
};

const merged = saleProceedsFromItemFields(item);
assert(merged.transactionFeeEur == null || merged.transactionFeeEur < 0.005, 'tx fee must not re-use label');
assert(Math.abs((merged.shippingLabelEur ?? 0) - 6.19) < 0.001, 'label stays 6.19');

const split = saleColumnSplit(item);
assert(split, 'split exists');
assert(Math.abs(split!.shippingEur - 6.19) < 0.001, 'delivery row is label once');
assert(split!.ebayFeeEur < 0.005, `ebay fee must be 0, got ${split!.ebayFeeEur}`);
assert(Math.abs((split!.netEur ?? 0) - 39) < 0.001, 'net stays 39');

const rows = saleProceedsRows(merged);
const outs = rows.filter((r) => r.tone === 'out');
assert(outs.length === 1 && Math.abs(outs[0]!.amount + 6.19) < 0.001, 'exactly one -6.19 deduction');

console.log('verify-integral-label-once: ok');
