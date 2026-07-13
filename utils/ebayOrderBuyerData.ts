import type { CustomerInfo } from '../types';
import type { EbayOrderRecord } from '../services/ebayOrderIndex';

export function customerFromEbayOrder(order: EbayOrderRecord): CustomerInfo {
  return {
    name: order.buyer.fullName || order.buyer.username || '',
    address: order.buyer.address || '',
    ...(order.buyer.phone ? { phone: order.buyer.phone } : {}),
    ...(order.buyer.email ? { email: order.buyer.email } : {}),
  };
}
