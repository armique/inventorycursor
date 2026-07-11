import React from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Loader2, ShoppingBag, X } from 'lucide-react';
import type { EbayListingPriceMatch } from '../services/ebayService';
import { formatEUR } from '../utils/formatMoney';

interface Props {
  open: boolean;
  itemName: string;
  currentStorePrice?: number;
  loading?: boolean;
  error?: string | null;
  match: EbayListingPriceMatch | null;
  onClose: () => void;
  onApply: (match: EbayListingPriceMatch) => void;
}

const EbayListingPriceModal: React.FC<Props> = ({
  open,
  itemName,
  currentStorePrice,
  loading = false,
  error = null,
  match,
  onClose,
  onApply,
}) => {
  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <div className="flex items-center gap-2 min-w-0">
            <ShoppingBag size={18} className="text-blue-600 shrink-0" />
            <h3 className="font-black text-slate-900 text-sm truncate">eBay storefront price • {itemName}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl shrink-0"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-4 max-h-[70vh] overflow-y-auto">
          {loading ? (
            <div className="py-8 flex flex-col items-center justify-center gap-3 text-slate-500">
              <Loader2 size={32} className="animate-spin text-blue-600" />
              <p className="text-xs font-bold">Matching your eBay listings…</p>
            </div>
          ) : error ? (
            <div className="py-4 flex items-start gap-3">
              <AlertCircle size={20} className="text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          ) : match ? (
            <div className="space-y-4">
              <p className="text-[11px] text-slate-500">
                Sets your public listing price (eBay / storefront). Sell price is only for when the item is
                actually sold.
              </p>
              <div>
                <p className="text-[10px] font-black uppercase text-slate-400 mb-1">Matched listing</p>
                {match.listingUrl ? (
                  <a
                    href={match.listingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-bold text-blue-600 hover:underline line-clamp-2"
                  >
                    {match.title}
                  </a>
                ) : (
                  <p className="text-sm font-bold text-slate-800 line-clamp-2">{match.title}</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                  <p className="text-[10px] font-black uppercase text-slate-400">eBay price</p>
                  <p className="text-xl font-black text-slate-700">€{formatEUR(match.rawPrice)}</p>
                </div>
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
                  <p className="text-[10px] font-black uppercase text-emerald-600">Rounded to .99</p>
                  <p className="text-xl font-black text-emerald-700">€{formatEUR(match.roundedPrice)}</p>
                </div>
              </div>
              {currentStorePrice != null && (
                <p className="text-xs text-slate-500">
                  Current storefront price:{' '}
                  <span className="font-bold text-slate-800">€{formatEUR(currentStorePrice)}</span>
                </p>
              )}
              {match.rawPrice !== match.roundedPrice && (
                <p className="text-[11px] text-amber-700 bg-amber-50 px-2 py-1.5 rounded border border-amber-200">
                  Cents adjusted from {formatEUR(match.rawPrice).replace('.', ',')} to ,99
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => onApply(match)}
                  className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl text-xs font-black hover:bg-emerald-700"
                >
                  Apply €{formatEUR(match.roundedPrice)} as storefront price
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="py-2.5 px-4 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default EbayListingPriceModal;
