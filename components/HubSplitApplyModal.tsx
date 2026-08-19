import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, X } from 'lucide-react';
import {
  type HubBreakdownReplaceReason,
  type HubBreakdownReplaceRow,
  type HubBreakdownSnapshot,
} from '../utils/replaceItemSaleProceedsFromHub';
import { formatEUR } from '../utils/formatMoney';

const REASON: Record<HubBreakdownReplaceReason, string> = {
  screenshot: 'screenshot split',
  estimated: 'estimated fees',
  missing: 'no breakdown yet',
  differs: 'amounts differ',
};

const FIELDS: Array<{ key: keyof HubBreakdownSnapshot; label: string }> = [
  { key: 'total', label: 'Buyer total' },
  { key: 'ads', label: 'Ads' },
  { key: 'ebay', label: 'eBay fee' },
  { key: 'ship', label: 'Label' },
  { key: 'refund', label: 'Refund' },
  { key: 'net', label: 'Net' },
  { key: 'profit', label: 'Margin' },
  { key: 'sell', label: 'Books' },
];

function moneyText(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '—' : `€${formatEUR(value)}`;
}

function fieldChanged(before: number | null | undefined, after: number | null | undefined): boolean {
  return Math.abs((before ?? 0) - (after ?? 0)) >= 0.02;
}

type Props = {
  rows: HubBreakdownReplaceRow[];
  applying?: boolean;
  onClose: () => void;
  onConfirm: (rows: HubBreakdownReplaceRow[]) => void;
};

const HubSplitApplyModal: React.FC<Props> = ({ rows, applying = false, onClose, onConfirm }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !applying) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [applying, onClose]);

  if (!rows.length) return null;

  const title =
    rows.length === 1 ? rows[0].itemName : `Apply Hub split on ${rows.length} items`;

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center bg-slate-900/65 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200"
      onClick={() => {
        if (!applying) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="hub-split-apply-title"
    >
      <div
        className="bg-white w-full h-[100dvh] sm:h-auto sm:max-h-[92vh] sm:max-w-lg sm:rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shrink-0 px-4 sm:px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-emerald-50 to-white flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[9px] font-black uppercase tracking-widest text-emerald-800">Before → after</p>
            <h2 id="hub-split-apply-title" className="text-base font-black text-slate-900 truncate">
              {title}
            </h2>
            <p className="text-[11px] text-slate-500 mt-1">
              Hub figures overwrite the current split. Screenshot / API guesses are replaced.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={applying}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 shrink-0 disabled:opacity-40"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
          {rows.map((row) => (
            <section key={row.itemId} className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-100">
                <p className="text-[13px] font-black text-slate-900 truncate" title={row.itemName}>
                  {row.itemName}
                </p>
                <p className="text-[10px] font-mono text-slate-500 truncate">
                  {row.orderId} · {REASON[row.reason]}
                </p>
              </div>
              <div className="divide-y divide-slate-100">
                {FIELDS.map((field) => {
                  const before = row.before[field.key] as number | null;
                  const after = row.after[field.key] as number | null;
                  const changed = fieldChanged(before, after);
                  return (
                    <div
                      key={field.key}
                      className={`grid grid-cols-[minmax(5.5rem,1fr)_minmax(4.5rem,auto)_auto_minmax(4.5rem,auto)] gap-2 items-center px-3 py-1.5 ${
                        changed ? 'bg-emerald-50/40' : ''
                      }`}
                    >
                      <span className="text-[11px] font-bold text-slate-500">{field.label}</span>
                      <span
                        className={`text-right tabular-nums text-[12px] font-bold ${
                          changed ? 'text-rose-600 line-through' : 'text-slate-600'
                        }`}
                      >
                        {moneyText(before)}
                      </span>
                      <ArrowRight
                        size={12}
                        className={`justify-self-center ${changed ? 'text-emerald-700' : 'text-slate-300'}`}
                      />
                      <span
                        className={`text-right tabular-nums text-[12px] font-black ${
                          changed ? 'text-emerald-800' : 'text-slate-700'
                        }`}
                      >
                        {moneyText(after)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <footer className="shrink-0 px-4 sm:px-5 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={applying}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-[10px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={applying}
            onClick={() => onConfirm(rows)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-50"
          >
            {applying ? 'Saving…' : rows.length === 1 ? 'Apply Hub split' : `Apply ${rows.length} splits`}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
};

export default HubSplitApplyModal;
