import { saleColumnSplit } from './utils/saleProceeds.ts';
import { ItemStatus } from './types.ts';

const item = {
  id: 'x',
  name: 'Integral',
  buyPrice: 20,
  buyDate: '2025-01-01',
  category: 'RAM',
  status: ItemStatus.SOLD,
  sellPrice: 45.19,
  sellDate: '2025-02-27',
  feeAmount: 6.19,
  sellerPaidShipping: false,
  saleProceeds: {
    capturedAt: new Date().toISOString(),
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

console.log(JSON.stringify(saleColumnSplit(item), null, 2));
