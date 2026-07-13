import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, PackageSearch, X } from 'lucide-react';
import { InventoryItem } from '../types';
import { peekEbaySalesSync } from '../services/ebaySalesSync';
import { getOrderIndexStats } from '../services/ebayOrderIndex';
import { summarizeAdjustmentSuggestions } from '../utils/ebaySaleAdjustments';

const DISMISS_COUNT_KEY = 'ebay_sales_sync_banner_dismissed_count';

interface Props {
  items: InventoryItem[];
}

function readDismissedCount(): number {
  try {
    return parseInt(localStorage.getItem(DISMISS_COUNT_KEY) || '0', 10) || 0;
  } catch {
    return 0;
  }
}

const EbaySyncBanner: React.FC<Props> = ({ items }) => {
  const [pending, setPending] = useState(0);
  const [markSold, setMarkSold] = useState(0);
  const [refundAdjustments, setRefundAdjustments] = useState(0);
  const [payoutAdjustments, setPayoutAdjustments] = useState(0);
  const [cachedOrders, setCachedOrders] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const refresh = useCallback(() => {
    const analysis = peekEbaySalesSync(items);
    const adj = summarizeAdjustmentSuggestions(analysis.suggestions);
    setPending(analysis.suggestions.length);
    setMarkSold(analysis.stats.markSoldCandidates);
    setRefundAdjustments(adj.refundLike + adj.restock);
    setPayoutAdjustments(adj.payoutFix + adj.fee);
    setCachedOrders(getOrderIndexStats().count);
    setDismissed(analysis.suggestions.length <= readDismissedCount());
  }, [items]);

  useEffect(() => {
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', refresh);
    window.addEventListener('ebay-order-index-updated', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', refresh);
      window.removeEventListener('ebay-order-index-updated', refresh);
    };
  }, [refresh]);

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_COUNT_KEY, String(pending));
    setDismissed(true);
  };

  if (dismissed) return null;

  if (!cachedOrders) {
    return (
      <div className="mb-6 flex items-center justify-between gap-4 p-4 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-950">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-xl bg-indigo-100 text-indigo-700 shrink-0">
            <PackageSearch size={18} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold">Set up eBay sales sync</p>
            <p className="text-xs text-indigo-800/90 mt-0.5">
              Import your order history once — then the app can suggest marking forgotten sales and linking order
              IDs automatically.
            </p>
          </div>
        </div>
        <Link
          to="/panel/ebay?tab=sales"
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-700 text-white text-xs font-black uppercase tracking-wide hover:bg-indigo-800"
        >
          Open sales sync
          <ArrowRight size={14} />
        </Link>
      </div>
    );
  }

  if (pending === 0) return null;

  return (
    <div className="mb-6 flex items-center justify-between gap-4 p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-950">
      <div className="flex items-center gap-3 min-w-0">
        <div className="p-2 rounded-xl bg-emerald-100 text-emerald-700 shrink-0">
          <PackageSearch size={18} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold">
            {pending} eBay sale{pending === 1 ? '' : 's'} need your review
          </p>
          <p className="text-xs text-emerald-900/90 mt-0.5">
            {markSold > 0
              ? `${markSold} in-stock item${markSold === 1 ? '' : 's'} may have sold on eBay`
              : refundAdjustments > 0
                ? `${refundAdjustments} return/refund adjustment${refundAdjustments === 1 ? '' : 's'} to document`
                : payoutAdjustments > 0
                  ? `${payoutAdjustments} payout adjustment${payoutAdjustments === 1 ? '' : 's'} to review`
                  : 'Link order IDs or fix sell prices to match what you actually received'}
            {' — '}
            nothing is applied until you confirm.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Link
          to="/panel/ebay?tab=sales"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-700 text-white text-xs font-black uppercase tracking-wide hover:bg-emerald-800"
        >
          Review
          <ArrowRight size={14} />
        </Link>
        <button
          type="button"
          onClick={handleDismiss}
          className="p-2 hover:bg-emerald-100 rounded-lg text-emerald-700"
          aria-label="Dismiss"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
};

export default EbaySyncBanner;
