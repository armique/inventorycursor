/**
 * Replace screenshot / estimated fee splits with Seller Hub dump figures.
 * Run: npx tsx scripts/verify-hub-breakdown-replace.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import type { EbayOrderFinancialEvent, EbayOrderRecord } from '../services/ebayOrderIndex';
import {
  applyHubBreakdownReplacePlan,
  buildHubBreakdownReplacePlan,
  hubBreakdownActionDetails,
  hubBreakdownItemsToSave,
} from '../utils/replaceItemSaleProceedsFromHub';
import { enforceContainerMembershipInvariants, findEmptyContainerShellIds } from '../utils/containerMembershipInvariants';
import { shouldHideContainerChildInList } from '../services/financialAggregation';
import { saleColumnSplit, saleProceedsFromOrder } from '../utils/saleProceeds';
import { computeItemProfitBeforeOverhead, computeSoldTabMargin, healRealizedProfitsFromSaleProceeds } from '../services/financialAggregation';

function hubEvent(
  orderId: string,
  amount: number,
  kind: EbayOrderFinancialEvent['kind'],
  transactionType: string
): EbayOrderFinancialEvent {
  return {
    id: `${orderId}:${transactionType}:${amount}`,
    date: '2025-08-01',
    kind,
    amount,
    transactionType,
    source: 'hub',
    importedAt: '2026-08-19T00:00:00.000Z',
  };
}

const hubOrder: EbayOrderRecord = {
  orderId: '03-11111-22222',
  creationDate: '2025-08-01',
  buyer: { username: 'buyer1' },
  lineItems: [{ sku: 'GPU-1', title: 'ASUS Dual RTX 3070', lineItemCost: 132.74 }],
  grossTotal: 138.93,
  netTotal: 107.73,
  sources: ['hub'],
  importedAt: '2026-08-19T00:00:00.000Z',
  financialEvents: [
    hubEvent('03-11111-22222', 138.93, 'sale', 'Bestellung'),
    hubEvent('03-11111-22222', -11.29, 'fee', 'Transaktionsgebühren'),
    hubEvent('03-11111-22222', -13.72, 'fee', 'Anzeigengebühr Basis'),
    hubEvent('03-11111-22222', -6.19, 'fee', 'Versandetikett'),
  ],
};

const screenshotItem: InventoryItem = {
  id: 'sold-gpu',
  name: 'ASUS Dual RTX 3070',
  buyPrice: 80,
  buyDate: '2025-06-01',
  sellDate: '2025-08-01',
  sellPrice: 107.73,
  category: 'GPU',
  status: ItemStatus.SOLD,
  comment1: '',
  comment2: '',
  platformSold: 'ebay.de',
  paymentType: 'ebay.de',
  ebayOrderId: '03-11111-22222',
  feeAmount: 20,
  hasFee: true,
  sellerPaidShipping: true,
  sellerShippingAmount: 6.19,
  saleProceeds: {
    capturedAt: '2025-08-02T00:00:00.000Z',
    source: 'ebay_screenshot',
    itemGrossEur: 107.73,
    buyerTotalEur: 107.73,
    transactionFeeEur: 20,
    adFeeEur: 0,
    shippingLabelEur: 6.19,
    netPayoutEur: 81.54,
  },
};

const alreadyHub: InventoryItem = {
  ...screenshotItem,
  id: 'already-ok',
  ebayUsername: 'buyer1',
  ebaySku: 'GPU-1',
  ebayOrderLineKey: '03-11111-22222::GPU-1',
  customer: { name: 'buyer1', address: '' },
  saleProceeds: {
    capturedAt: '2026-08-19T00:00:00.000Z',
    source: 'ebay_seller_hub',
    itemGrossEur: 132.74,
    buyerShippingEur: 6.19,
    buyerTotalEur: 138.93,
    transactionFeeEur: 11.29,
    adFeeEur: 13.72,
    shippingLabelEur: 6.19,
    otherFeeEur: 0,
    netPayoutEur: 107.73,
    feesEstimated: false,
  },
};

const unlinked: InventoryItem = {
  ...screenshotItem,
  id: 'no-order',
  ebayOrderId: undefined,
};

const estimated: InventoryItem = {
  ...screenshotItem,
  id: 'guessed',
  ebayOrderId: '03-11111-22222',
  saleProceeds: {
    capturedAt: '2025-08-02T00:00:00.000Z',
    source: 'ebay_order',
    buyerTotalEur: 138.93,
    transactionFeeEur: 34.73,
    adFeeEur: null,
    netPayoutEur: 104.2,
    feesEstimated: true,
  },
};

const plan = buildHubBreakdownReplacePlan(
  [screenshotItem, alreadyHub, unlinked, estimated],
  [hubOrder],
  'SmallBusiness'
);
assert.equal(plan.length, 2);
assert.deepEqual(
  plan.map((r) => r.itemId).sort(),
  ['guessed', 'sold-gpu']
);
const shot = plan.find((r) => r.itemId === 'sold-gpu');
assert.ok(shot);
assert.equal(shot.reason, 'screenshot');
assert.equal(shot.after.ads, 13.72);
assert.equal(shot.after.ebay, 11.29);
assert.equal(shot.after.ship, 6.19);
assert.equal(shot.after.net, 107.73);
assert.equal(shot.after.sell, 138.93);
assert.equal(shot.nextItem.saleProceeds?.source, 'ebay_seller_hub');
assert.equal(shot.nextItem.saleProceeds?.feesEstimated, false);
assert.equal(shot.nextItem.sellerPaidShipping, false);

const next = applyHubBreakdownReplacePlan(
  [screenshotItem, alreadyHub, unlinked, estimated],
  plan
);
const updated = next.find((i) => i.id === 'sold-gpu');
assert.ok(updated);
assert.equal(updated.sellPrice, 138.93);
assert.equal(updated.feeAmount, 31.2);
const split = saleColumnSplit(updated);
assert.equal(split?.adFeeEur, 13.72);
assert.equal(split?.ebayFeeEur, 11.29);
assert.equal(split?.shippingEur, 6.19);
assert.equal(split?.netEur, 107.73);

const untouched = next.find((i) => i.id === 'already-ok');
assert.equal(untouched?.saleProceeds?.source, 'ebay_seller_hub');
assert.equal(next.find((i) => i.id === 'no-order')?.saleProceeds?.source, 'ebay_screenshot');

const shotDetails = hubBreakdownActionDetails(shot);
assert.match(shotDetails, /03-11111-22222/);
assert.match(shotDetails, /buyer €138,93/);
assert.match(shotDetails, /sold 2025-08-01/);

// Approve must not rewrite sellDate (Sold-tab month filter) or nest/trash the row.
assert.equal(shot.nextItem.status, ItemStatus.SOLD);
assert.equal(shot.nextItem.id, 'sold-gpu');
assert.equal(shot.nextItem.sellDate, '2025-08-01');
assert.equal(shot.nextItem.parentContainerId, screenshotItem.parentContainerId);
assert.deepEqual(shot.nextItem.componentIds, screenshotItem.componentIds);

const dated = {
  ...screenshotItem,
  id: 'dated-usb',
  name: 'Integral 32GB',
  sellDate: '2026-08-15',
  parentContainerId: undefined,
};
const datedPlan = buildHubBreakdownReplacePlan([dated], [hubOrder], 'SmallBusiness');
assert.equal(datedPlan.length, 1);
assert.equal(datedPlan[0].nextItem.status, ItemStatus.SOLD);
assert.equal(datedPlan[0].nextItem.id, 'dated-usb');
assert.equal(datedPlan[0].nextItem.sellDate, '2026-08-15');
assert.equal(datedPlan[0].nextItem.parentContainerId, undefined);

const sibling = { ...alreadyHub };
const catalog = [dated, sibling];
const persist = hubBreakdownItemsToSave(datedPlan);
assert.deepEqual(persist.map((i) => i.id), ['dated-usb']);
const merged = catalog.map((item) => persist.find((p) => p.id === item.id) || item);
assert.equal(merged.length, 2);
assert.equal(merged.find((i) => i.id === 'dated-usb')?.status, ItemStatus.SOLD);
assert.equal(merged.find((i) => i.id === 'already-ok'), sibling);
assert.equal(shouldHideContainerChildInList(datedPlan[0].nextItem, merged), false);

const refundedOrder: EbayOrderRecord = {
  ...hubOrder,
  orderId: '03-refund-usb',
  financialEvents: [
    ...(hubOrder.financialEvents || []),
    hubEvent('03-refund-usb', -138.93, 'refund', 'Rückerstattung'),
  ],
};
const refundedItem: InventoryItem = {
  ...screenshotItem,
  id: 'refunded-usb',
  name: 'Integral 32GB',
  ebayOrderId: '03-refund-usb',
};
const refundPlan = buildHubBreakdownReplacePlan([refundedItem], [refundedOrder], 'SmallBusiness');
assert.equal(refundPlan.length, 1);
assert.equal(refundPlan[0].nextItem.status, ItemStatus.SOLD);
assert.equal(refundPlan[0].nextItem.sellPrice, 138.93);
assert.equal(refundPlan[0].nextItem.id, refundedItem.id);

// Passing the whole catalog through membership after a fee overwrite used to
// trash emptied sold shells / hide children listed on a parent.
const usb: InventoryItem = {
  ...screenshotItem,
  id: 'usb-32',
  name: 'Integral 32GB',
  isBundle: false,
  parentContainerId: undefined,
};
const emptyLot: InventoryItem = {
  ...screenshotItem,
  id: 'usb-lot',
  name: 'USB lot',
  isBundle: true,
  category: 'Bundle',
  componentIds: ['usb-32'],
  parentContainerId: undefined,
};
const usbPlan = buildHubBreakdownReplacePlan([usb], [hubOrder], 'SmallBusiness');
assert.equal(usbPlan[0].nextItem.parentContainerId, undefined);
assert.equal(usbPlan[0].nextItem.isBundle, false);
const afterApprove = [usbPlan[0].nextItem, emptyLot];
assert.equal(afterApprove.find((i) => i.id === 'usb-32')?.status, ItemStatus.SOLD);

const enforced = enforceContainerMembershipInvariants(afterApprove);
assert.ok(!enforced.deleteIds.includes('usb-32'));
assert.ok(enforced.nextItems.some((i) => i.id === 'usb-32' && i.status === ItemStatus.SOLD));
const emptyShells = findEmptyContainerShellIds(enforced.nextItems);
assert.ok(!emptyShells.includes('usb-32'));

const corsairHub: EbayOrderRecord = {
  orderId: '03-15053-36524',
  creationDate: '2026-08-19',
  buyer: { username: 'aron68460', fullName: 'Aron Shake' },
  lineItems: [
    {
      sku: null,
      title: 'Corsair iCUE LINK System Hub Controller Schwarz (Ohne Kabel)',
      lineItemCost: 11.77,
    },
  ],
  grossTotal: 11.77,
  netTotal: 8.02,
  sources: ['hub'],
  importedAt: '2026-08-19T00:00:00.000Z',
  financialEvents: [
    hubEvent('03-15053-36524', 11.77, 'sale', 'Bestellung'),
    hubEvent('03-15053-36524', -3.75, 'fee', 'Transaktionsgebühren'),
    hubEvent('03-15053-36524', -5, 'refund', 'Erstattet'),
  ],
};
const corsairItem: InventoryItem = {
  ...screenshotItem,
  id: 'corsair-hub',
  name: 'Corsair iCUE LINK System Hub Controller Schwarz (Ohne Kabel)',
  buyPrice: 5,
  sellPrice: 11.77,
  feeAmount: 3.75,
  sellerPaidShipping: false,
  sellerShippingAmount: undefined,
  ebayOrderId: '03-15053-36524',
  saleProceeds: {
    capturedAt: '2026-08-19T00:00:00.000Z',
    source: 'ebay_seller_hub',
    buyerTotalEur: 11.77,
    transactionFeeEur: 3.75,
    adFeeEur: 0,
    netPayoutEur: 8.02,
    feesEstimated: false,
  },
};
const corsairPlan = buildHubBreakdownReplacePlan([corsairItem], [corsairHub], 'DifferentialVAT');
assert.equal(corsairPlan.length, 1);
assert.equal(corsairPlan[0].reason, 'differs');
assert.equal(corsairPlan[0].after.refund, 5);
assert.equal(corsairPlan[0].after.ebay, 3.75);
assert.equal(corsairPlan[0].after.net, 3.02);
assert.equal(corsairPlan[0].nextItem.saleProceeds?.refundEur, 5);
assert.equal(corsairPlan[0].nextItem.profit, -1.98);
assert.equal(
  computeItemProfitBeforeOverhead(corsairPlan[0].nextItem, 'DifferentialVAT'),
  -1.98
);
assert.equal(computeItemProfitBeforeOverhead(corsairPlan[0].nextItem, 'SmallBusiness'), -1.98);

const bookedGpu: InventoryItem = {
  ...screenshotItem,
  id: 'booked-gpu',
  sellPrice: 138.93,
  feeAmount: 31.2,
  sellerPaidShipping: false,
  sellerShippingAmount: undefined,
  saleProceeds: undefined,
};
const bookedBeforeCash = computeItemProfitBeforeOverhead(bookedGpu, 'SmallBusiness');
const bookedPlan = buildHubBreakdownReplacePlan([bookedGpu], [hubOrder], 'SmallBusiness');
assert.equal(bookedPlan.length, 1);
assert.equal(computeItemProfitBeforeOverhead(bookedPlan[0].nextItem, 'SmallBusiness'), bookedBeforeCash);
assert.equal(bookedPlan[0].nextItem.profit, bookedBeforeCash);

const refundOnlyHub: EbayOrderRecord = {
  ...corsairHub,
  orderId: '03-15053-36524',
  netTotal: 6.77,
  financialEvents: [
    hubEvent('03-15053-36524', 11.77, 'sale', 'Bestellung'),
    hubEvent('03-15053-36524', -5, 'refund', 'Erstattet'),
  ],
};
const refundOnlyPlan = buildHubBreakdownReplacePlan([corsairItem], [refundOnlyHub], 'DifferentialVAT');
assert.equal(refundOnlyPlan.length, 1);
assert.equal(refundOnlyPlan[0].nextItem.saleProceeds?.transactionFeeEur, 3.75);
assert.equal(refundOnlyPlan[0].nextItem.saleProceeds?.refundEur, 5);
assert.equal(refundOnlyPlan[0].after.net, 3.02);
assert.equal(refundOnlyPlan[0].nextItem.profit, -1.98);

// Fees already match Hub, but buyer/username were never typed — still offer Hub cell.
const metaGapItem: InventoryItem = {
  ...alreadyHub,
  id: 'meta-gap',
  ebayUsername: undefined,
  customer: undefined,
  ebaySku: undefined,
};
const metaPlan = buildHubBreakdownReplacePlan([metaGapItem], [hubOrder], 'SmallBusiness');
assert.equal(metaPlan.length, 1);
assert.equal(metaPlan[0].reason, 'order_meta');
assert.equal(metaPlan[0].nextItem.ebayUsername, 'buyer1');
assert.equal(metaPlan[0].nextItem.customer?.name, 'buyer1');
assert.equal(metaPlan[0].nextItem.ebaySku, 'GPU-1');
assert.equal(metaPlan[0].nextItem.saleProceeds?.netPayoutEur, 107.73);
assert.equal(metaPlan[0].nextItem.sellDate, metaGapItem.sellDate);

// Applying Hub fees also backfills blank order fields on a screenshot row.
assert.equal(shot.nextItem.ebayUsername, 'buyer1');
assert.equal(shot.nextItem.ebaySku, 'GPU-1');
assert.equal(shot.nextItem.customer?.name, 'buyer1');

// Margin must equal sell-cell net − EK after Hub apply (and heal stale stored profit).
{
  const afterHub = shot.nextItem;
  const split = saleColumnSplit(afterHub);
  assert.ok(split?.netEur != null);
  const expectedMargin = Math.round((split!.netEur! - afterHub.buyPrice) * 100) / 100;
  assert.equal(computeSoldTabMargin(afterHub), expectedMargin, 'sold margin = net − EK');
  assert.equal(afterHub.profit, expectedMargin, 'stored profit stamped to pocket margin');

  const stale: InventoryItem = { ...afterHub, profit: 999 };
  const healed = healRealizedProfitsFromSaleProceeds([stale], 'SmallBusiness');
  assert.equal(healed.length, 1);
  assert.equal(healed[0].profit, expectedMargin);
}

// Multi-line Hub order: Hub sell must use THIS line's share, not the whole order total.
{
  const multiOrder: typeof hubOrder = {
    ...hubOrder,
    orderId: '03-99999-11111',
    lineItems: [
      { sku: 'GPU-1', title: 'GPU A', lineItemCost: 100, listingId: '1' },
      { sku: 'RAM-1', title: 'RAM B', lineItemCost: 50, listingId: '2' },
    ],
    grossTotal: 150,
    netTotal: 120,
    feeTotal: 30,
    financialEvents: [
      { kind: 'sale', amount: 150, transactionType: 'Bestellung', description: 'Sale' },
      { kind: 'fee', amount: -20, transactionType: 'Verkaufsgebühr', description: 'FV' },
      { kind: 'fee', amount: -10, transactionType: 'Anzeigengebühr', description: 'Ads' },
    ],
  };
  const lineA = multiOrder.lineItems[0];
  const fromOrder = saleProceedsFromOrder(multiOrder, lineA);
  assert.equal(fromOrder.buyerTotalEur, 100, 'line buyer total is line gross, not order 150');
  assert.equal(fromOrder.transactionFeeEur, 13.33, 'tx fee prorated 100/150');
  assert.equal(fromOrder.adFeeEur, 6.67, 'ads fee prorated 100/150');
  assert.equal(fromOrder.netPayoutEur, 80, 'net prorated 100/150 of 120');

  const multiItem: InventoryItem = {
    ...screenshotItem,
    id: 'multi-a',
    ebayOrderId: '03-99999-11111',
    ebaySku: 'GPU-1',
    sellPrice: 100,
    saleProceeds: {
      capturedAt: '2025-08-02T00:00:00.000Z',
      source: 'ebay_screenshot',
      buyerTotalEur: 100,
      transactionFeeEur: 13.33,
      adFeeEur: 6.67,
      netPayoutEur: 80,
      feesEstimated: false,
    },
  };
  const multiPlan = buildHubBreakdownReplacePlan([multiItem], [multiOrder], 'SmallBusiness');
  // Screenshot source still offers replace, but after snapshot must stay on line share.
  assert.ok(multiPlan.length === 1);
  assert.equal(multiPlan[0].after.total, 100);
  assert.equal(multiPlan[0].after.sell, 100);
  assert.equal(multiPlan[0].after.net, 80);
  assert.notEqual(multiPlan[0].after.total, 150);
}

console.log('verify-hub-breakdown-replace: ok');
