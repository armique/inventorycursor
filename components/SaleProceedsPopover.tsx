import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { InventoryItem, SaleProceedsBreakdown } from '../types';
import { formatEUR } from '../utils/formatMoney';
import {
  resolveSaleProceeds,
  saleProceedsHasDetail,
  saleProceedsRows,
} from '../utils/saleProceeds';

function toneClass(tone: 'in' | 'out' | 'total' | 'net'): string {
  if (tone === 'out') return 'text-amber-800';
  if (tone === 'net') return 'text-emerald-800 font-black';
  if (tone === 'total') return 'text-slate-900 font-black';
  return 'text-slate-700';
}

export function SaleProceedsDialog({
  breakdown,
  onClose,
}: {
  breakdown: SaleProceedsBreakdown;
  onClose: () => void;
}) {
  const rows = saleProceedsRows(breakdown);
  return (
    <div
      className="fixed inset-0 z-[240] bg-slate-900/50 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-sm rounded-2xl shadow-2xl border border-slate-100 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
              Verkaufserlös
            </p>
            <h3 className="text-sm font-black text-slate-900">Where the money went</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>
        <div className="px-4 py-3 space-y-1.5">
          {rows.length === 0 ? (
            <p className="text-xs text-slate-400 font-semibold">No fee breakdown on this sale.</p>
          ) : (
            rows.map((row) => (
              <div
                key={row.id}
                className={`flex items-center justify-between gap-3 text-[12px] font-bold tabular-nums ${
                  row.tone === 'total' || row.tone === 'net' ? 'pt-2 mt-1 border-t border-slate-100' : ''
                }`}
              >
                <span className={row.tone === 'out' ? 'text-slate-500' : 'text-slate-600'}>{row.label}</span>
                <span className={toneClass(row.tone)}>
                  {row.amount < 0 ? '−' : ''}€{formatEUR(Math.abs(row.amount))}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

type TriggerProps = {
  item?: InventoryItem;
  breakdown?: SaleProceedsBreakdown | null;
  children: React.ReactNode;
  className?: string;
  onDoubleClick?: (e: React.MouseEvent) => void;
};

export const SaleProceedsTrigger: React.FC<TriggerProps> = ({
  item,
  breakdown,
  children,
  className,
  onDoubleClick,
}) => {
  const [open, setOpen] = useState(false);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolved = breakdown ?? (item ? resolveSaleProceeds(item) : null);
  const canOpen = saleProceedsHasDetail(resolved);

  useEffect(() => {
    return () => {
      if (clickTimer.current) clearTimeout(clickTimer.current);
    };
  }, []);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canOpen || !resolved) return;
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => setOpen(true), 220);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    onDoubleClick?.(e);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        className={`bg-transparent p-0 border-0 cursor-pointer appearance-none ${className || ''}`}
        title={canOpen ? 'Click for fees, shipping and payout' : undefined}
      >
        {children}
      </button>
      {open && resolved
        ? createPortal(<SaleProceedsDialog breakdown={resolved} onClose={() => setOpen(false)} />, document.body)
        : null}
    </>
  );
};
