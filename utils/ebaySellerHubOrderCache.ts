import { applyBusinessTxFeePolicy, looksLikeJunkPerson, type EbaySellerHubPayout } from '../lib/ebaySellerHubPayout';
import {
  pushOrderIndexToCloud,
  upsertEbayOrders,
  type EbayOrderFinancialEvent,
  type EbayOrderRecord,
} from '../services/ebayOrderIndex';
import { financialEventId } from './ebayOrderFinancial';
import { roundMoney } from '../services/financialAggregation';

function hubEvent(
  order: EbayOrderRecord,
  kind: EbayOrderFinancialEvent['kind'],
  amount: number,
  transactionType: string
): EbayOrderFinancialEvent {
  const importedAt = new Date().toISOString();
  return {
    id: financialEventId({
      orderId: order.orderId,
      date: order.creationDate,
      amount,
      kind,
      description: `hub:${transactionType}`,
    }),
    date: order.creationDate,
    kind,
    amount,
    transactionType,
    description: 'Seller Hub Verkaufserlös',
    source: 'hub',
    importedAt,
  };
}

/** Turn a parsed Seller Hub payout into signed cache events so later binds are exact. */
export function financialEventsFromHubPayout(
  order: EbayOrderRecord,
  payout: EbaySellerHubPayout
): EbayOrderFinancialEvent[] {
  const events: EbayOrderFinancialEvent[] = [];
  const sale = payout.buyerTotalEur ?? payout.itemGrossEur;
  if (sale != null && sale > 0) {
    events.push(hubEvent(order, 'sale', roundMoney(sale), 'Bestellung'));
  }
  if (payout.transactionFeeEur != null && payout.transactionFeeEur >= 0.01) {
    events.push(
      hubEvent(order, 'fee', -roundMoney(payout.transactionFeeEur), 'Transaktionsgebühren')
    );
  }
  if (payout.adFeeEur != null && payout.adFeeEur >= 0.01) {
    events.push(
      hubEvent(order, 'fee', -roundMoney(payout.adFeeEur), 'Anzeigengebühr Basis')
    );
  }
  if (payout.shippingLabelEur != null && payout.shippingLabelEur >= 0.01) {
    events.push(hubEvent(order, 'fee', -roundMoney(payout.shippingLabelEur), 'Versandetikett'));
  }
  if (payout.otherFeeEur != null && payout.otherFeeEur >= 0.01) {
    events.push(hubEvent(order, 'fee', -roundMoney(payout.otherFeeEur), 'Weitere Gebühren'));
  }
  return events;
}

export function persistHubPayoutOnCachedOrder(
  order: EbayOrderRecord,
  rawPayout: EbaySellerHubPayout
): EbayOrderRecord {
  const payout = applyBusinessTxFeePolicy(rawPayout, order.creationDate);
  const feeTotal = roundMoney(
    (payout.transactionFeeEur ?? 0) +
      (payout.adFeeEur ?? 0) +
      (payout.shippingLabelEur ?? 0) +
      (payout.otherFeeEur ?? 0)
  );
  const incoming: EbayOrderRecord = {
    ...order,
    orderId: payout.orderId || order.orderId,
    buyer: {
      username: looksLikeJunkPerson(payout.username) ? order.buyer.username : payout.username || order.buyer.username,
      fullName: looksLikeJunkPerson(payout.fullName) ? order.buyer.fullName : payout.fullName || order.buyer.fullName,
      address: looksLikeJunkPerson(payout.address) ? order.buyer.address : payout.address || order.buyer.address,
      email: order.buyer.email,
      phone: order.buyer.phone,
    },
    grossTotal: payout.buyerTotalEur ?? order.grossTotal,
    netTotal: payout.netPayoutEur ?? order.netTotal,
    feeTotal: feeTotal > 0 ? feeTotal : order.feeTotal,
    financialEvents: financialEventsFromHubPayout(order, payout),
    sources: Array.from(new Set([...order.sources, 'hub' as const])),
    importedAt: new Date().toISOString(),
  };
  const result = upsertEbayOrders([incoming]);
  void pushOrderIndexToCloud(result.changed).catch(() => {
    /* local cache is enough for this bind */
  });
  return result.changed[0] || incoming;
}
