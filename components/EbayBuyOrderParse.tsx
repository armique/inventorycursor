import React, { useMemo, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import type { InventoryItem, PaymentType } from '../types';
import { listEbayPurchases } from '../services/ebayService';
import {
  loadEbayPurchaseIndex,
  upsertEbayPurchases,
  type EbayPurchaseRecord,
} from '../services/ebayPurchaseIndex';
import { formatPurchaseBuySummary } from '../utils/ebayPurchaseToInventory';
import { cleanEbayListingTitle } from '../utils/ebayBulkSyncPlan';
import { ADD_FLOW_INPUT, ADD_FLOW_LABEL } from './addFlowShared';
import { formatEUR } from '../utils/formatMoney';

function purchasesMatchingOrderId(orderId: string): EbayPurchaseRecord[] {
  const id = orderId.trim().toLowerCase();
  if (!id) return [];
  return loadEbayPurchaseIndex().purchases.filter((p) => p.orderId.toLowerCase() === id);
}

function purchasesMatchingTitle(name: string, limit = 5): EbayPurchaseRecord[] {
  const q = name.trim().toLowerCase();
  if (q.length < 3) return [];
  const tokens = q.split(/\s+/).filter((t) => t.length > 2);
  const scored = loadEbayPurchaseIndex()
    .purchases.map((p) => {
      const title = (p.title || '').toLowerCase();
      let score = 0;
      if (title.includes(q)) score += 10;
      for (const t of tokens) {
        if (title.includes(t)) score += 1;
      }
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (b.p.creationDate || '').localeCompare(a.p.creationDate || ''));
  return scored.slice(0, limit).map((x) => x.p);
}

export function patchFromEbayPurchase(purchase: EbayPurchaseRecord): Partial<InventoryItem> {
  const buyPrice =
    purchase.totalPaid != null && Number.isFinite(purchase.totalPaid)
      ? purchase.totalPaid
      : purchase.unitPrice != null && Number.isFinite(purchase.unitPrice)
        ? purchase.unitPrice * Math.max(1, purchase.quantity || 1)
        : undefined;
  const cleaned = cleanEbayListingTitle(purchase.title) || purchase.title.trim();
  return {
    platformBought: 'ebay.de',
    buyPaymentType: 'ebay.de' as PaymentType,
    vendor: purchase.sellerUsername ? `eBay: ${purchase.sellerUsername}` : 'eBay',
    ebayOrderId: purchase.orderId,
    buyDate: purchase.creationDate || undefined,
    ...(buyPrice != null ? { buyPrice } : {}),
    comment1: formatPurchaseBuySummary(purchase),
    name: cleaned || undefined,
  };
}

type Props = {
  itemName: string;
  onApply: (patch: Partial<InventoryItem>) => void;
};

/**
 * Pull seller / price / date / order id from cached eBay buyer purchases (API sync if needed).
 */
const EbayBuyOrderParse: React.FC<Props> = ({ itemName, onApply }) => {
  const [orderId, setOrderId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [matches, setMatches] = useState<EbayPurchaseRecord[]>([]);

  const titleHints = useMemo(() => purchasesMatchingTitle(itemName, 4), [itemName]);

  const applyPurchase = (p: EbayPurchaseRecord) => {
    onApply(patchFromEbayPurchase(p));
    setOrderId(p.orderId);
    setMatches([]);
    setMessage(`Filled from order ${p.orderId}${p.sellerUsername ? ` · ${p.sellerUsername}` : ''}`);
  };

  const lookup = async () => {
    const id = orderId.trim();
    if (!id) {
      setMessage('Enter an eBay order ID');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      let found = purchasesMatchingOrderId(id);
      if (!found.length) {
        const to = new Date();
        const from = new Date();
        from.setDate(from.getDate() - 90);
        const fromDate = from.toISOString().slice(0, 10);
        const toDate = to.toISOString().slice(0, 10);
        const remote = await listEbayPurchases(fromDate, toDate);
        if (remote.length) {
          upsertEbayPurchases(
            remote.map((r) => ({
              lineKey: r.lineKey,
              orderId: r.orderId,
              transactionId: r.transactionId,
              itemId: r.itemId,
              title: r.title,
              sellerUsername: r.sellerUsername,
              creationDate: r.creationDate,
              quantity: r.quantity,
              unitPrice: r.unitPrice,
              totalPaid: r.totalPaid,
            })),
            'api'
          );
        }
        found = purchasesMatchingOrderId(id);
      }
      if (!found.length) {
        setMatches([]);
        setMessage('Order not found in purchase cache. Sync Purchases in eBay tools, then retry.');
        return;
      }
      if (found.length === 1) {
        applyPurchase(found[0]);
        return;
      }
      setMatches(found);
      setMessage(`${found.length} lines on this order — pick one`);
    } catch (e) {
      setMessage((e as Error)?.message || 'Could not fetch eBay purchases');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className={ADD_FLOW_LABEL}>eBay order parse</p>
      <div className="flex gap-2">
        <input
          className={ADD_FLOW_INPUT}
          placeholder="Order ID (e.g. 12-34567-89012)"
          value={orderId}
          onChange={(e) => setOrderId(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void lookup();
            }
          }}
        />
        <button
          type="button"
          onClick={() => void lookup()}
          disabled={busy || !orderId.trim()}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-wider hover:bg-slate-800 disabled:opacity-40"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          Fill
        </button>
      </div>
      {message && <p className="text-[10px] font-semibold text-slate-500">{message}</p>}

      {(matches.length > 0 || titleHints.length > 0) && (
        <ul className="rounded-xl border border-slate-200 bg-slate-50/80 max-h-36 overflow-y-auto divide-y divide-slate-100">
          {(matches.length ? matches : titleHints).map((p) => (
            <li key={p.lineKey}>
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 hover:bg-white transition-colors"
                onClick={() => applyPurchase(p)}
              >
                <p className="text-xs font-bold text-slate-900 truncate">{p.title}</p>
                <p className="text-[10px] font-semibold text-slate-400 truncate">
                  #{p.orderId}
                  {p.sellerUsername ? ` · ${p.sellerUsername}` : ''}
                  {p.totalPaid != null ? ` · €${formatEUR(p.totalPaid)}` : ''}
                  {p.creationDate ? ` · ${p.creationDate}` : ''}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default EbayBuyOrderParse;
