import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, X } from 'lucide-react';
import type { EbayReminderPending } from '../services/ebayListingReminder';

type Variant = 'sidebar' | 'banner' | 'float';

interface Props {
  reminder: EbayReminderPending;
  onDismiss: () => void;
  variant?: Variant;
  checksRemaining?: number;
}

const EbaySoldReminderWidget: React.FC<Props> = ({
  reminder,
  onDismiss,
  variant = 'banner',
  checksRemaining,
}) => {
  const soldTabLink = '/panel/ebay-store-pull?tab=sold';

  const title =
    reminder.matchCount > 0
      ? `${reminder.matchCount} possible eBay sale${reminder.matchCount === 1 ? '' : 's'}`
      : reminder.disappearedCount > 0
        ? `${reminder.disappearedCount} listing${reminder.disappearedCount === 1 ? '' : 's'} removed from eBay`
        : `${reminder.appearedCount ?? 0} new listing${(reminder.appearedCount ?? 0) === 1 ? '' : 's'} on eBay`;

  const subtitle =
    reminder.matchCount > 0
      ? `${reminder.disappearedCount} listing${reminder.disappearedCount === 1 ? '' : 's'} removed since last check — update inventory & sell prices.`
      : reminder.disappearedCount > 0
        ? 'Review ended eBay listings from the saved snapshot and mark sold items in inventory.'
        : 'New eBay listings since last snapshot — add missing items to inventory.';

  if (variant === 'sidebar') {
    return (
      <div className="mb-3 rounded-xl border border-rose-500/40 bg-gradient-to-br from-rose-950/80 to-slate-900/90 p-3 shadow-lg ring-1 ring-rose-400/20">
        <div className="flex items-start gap-2">
          <AlertTriangle size={16} className="text-rose-400 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-black text-rose-100 leading-snug">{title}</p>
            <p className="text-[10px] text-rose-200/80 mt-1 leading-snug">{subtitle}</p>
            <Link
              to={soldTabLink}
              className="mt-2 inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-white bg-rose-600 hover:bg-rose-500 px-2.5 py-1.5 rounded-lg"
            >
              Review <ArrowRight size={10} />
            </Link>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="p-1 rounded-lg text-rose-300/70 hover:text-white hover:bg-white/10"
            aria-label="Dismiss reminder"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  if (variant === 'float') {
    return (
      <div className="fixed bottom-20 md:bottom-6 right-4 z-[120] max-w-sm animate-in slide-in-from-right-4 fade-in">
        <div className="rounded-2xl border border-rose-200 bg-white shadow-2xl shadow-rose-900/10 p-4 ring-1 ring-rose-100">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-rose-100 text-rose-600 shrink-0">
              <AlertTriangle size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black text-slate-900">{title}</p>
              <p className="text-xs text-slate-500 mt-1">{subtitle}</p>
              {checksRemaining != null && (
                <p className="text-[10px] text-slate-400 mt-1">
                  Auto-checks left today: {checksRemaining}
                </p>
              )}
              <Link
                to={soldTabLink}
                className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-white bg-rose-600 hover:bg-rose-700 px-3 py-2 rounded-xl"
              >
                Open Detect sold <ArrowRight size={12} />
              </Link>
            </div>
            <button
              type="button"
              onClick={onDismiss}
              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"
              aria-label="Dismiss"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-rose-200 bg-gradient-to-r from-rose-50 to-orange-50/80 p-4 flex flex-wrap items-center gap-3 shadow-sm">
      <div className="p-2.5 rounded-xl bg-rose-100 text-rose-600 shrink-0">
        <AlertTriangle size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-black text-slate-900">{title}</p>
        <p className="text-xs text-slate-600 mt-0.5">{subtitle}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Link
          to={soldTabLink}
          className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-white bg-rose-600 hover:bg-rose-700 px-4 py-2.5 rounded-xl"
        >
          Review sales <ArrowRight size={12} />
        </Link>
        <button
          type="button"
          onClick={onDismiss}
          className="p-2 rounded-xl text-slate-400 hover:bg-white/80 border border-transparent hover:border-slate-200"
          aria-label="Dismiss"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
};

export default EbaySoldReminderWidget;
