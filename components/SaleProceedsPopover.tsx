import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Truck, X } from 'lucide-react';
import type { InventoryItem, SaleProceedsBreakdown } from '../types';
import { formatEUR, parseLocaleNumber } from '../utils/formatMoney';
import {
  applyManualSellerShipping,
  canEditManualSellerShipping,
  resolveSaleProceeds,
  saleProceedsHasDetail,
  saleProceedsRows,
} from '../utils/saleProceeds';
import { computeSoldTabMargin } from '../services/financialAggregation';

function toneClass(tone: 'in' | 'out' | 'total' | 'net'): string {
  if (tone === 'out') return 'text-orange-600';
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
          {breakdown.feesEstimated && (
            <p className="text-[10px] font-semibold text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5">
              Fees here are Flip Coach estimates. Paste Seller Hub (Vom Käufer bezahlt → Bestelleinnahmen) for Finanzamt-exact numbers.
            </p>
          )}
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

export function SellerShippingEditorDialog({
  item,
  onSave,
  onClose,
}: {
  item: InventoryItem;
  onSave: (amount: number) => void;
  onClose: () => void;
}) {
  const initial =
    item.sellerPaidShipping && Number(item.sellerShippingAmount) >= 0.01
      ? String(item.sellerShippingAmount)
      : '';
  const [text, setText] = useState(initial);
  const parsed = parseLocaleNumber(text);
  const amount = text.trim() === '' || !Number.isFinite(parsed) ? 0 : Math.max(0, parsed);
  const preview = applyManualSellerShipping(item, amount);
  const margin = computeSoldTabMargin(preview);

  const commit = (nextAmount: number) => {
    onSave(nextAmount);
    onClose();
  };

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
            <p className="text-[9px] font-black uppercase tracking-widest text-sky-600 flex items-center gap-1">
              <Truck size={11} /> Shipping you paid
            </p>
            <h3 className="text-sm font-black text-slate-900 truncate">{item.name}</h3>
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
        <div className="px-4 py-3 space-y-3">
          <p className="text-[11px] font-semibold text-slate-500">
            Not an eBay Hub sale — add DHL / postage here. It comes out of pocket margin.
          </p>
          <label className="block space-y-1">
            <span className="text-[9px] font-black uppercase tracking-wider text-sky-700">Shipping €</span>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sky-400 text-sm font-bold">€</span>
              <input
                autoFocus
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                className="w-full pl-8 pr-3 py-2.5 rounded-xl border border-sky-200 bg-sky-50/60 font-black text-lg tabular-nums text-sky-900 outline-none focus:border-sky-400"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commit(amount);
                  if (e.key === 'Escape') onClose();
                }}
              />
            </div>
          </label>
          <div className="flex items-center justify-between text-[12px] font-bold tabular-nums">
            <span className="text-slate-500">Sold</span>
            <span className="text-slate-900">€{formatEUR(Number(item.sellPrice) || 0)}</span>
          </div>
          <div className="flex items-center justify-between text-[12px] font-bold tabular-nums">
            <span className="text-slate-500">Margin after shipping</span>
            <span className={margin >= 0 ? 'text-emerald-600' : 'text-red-500'}>
              {margin >= 0 ? '+' : ''}€{formatEUR(margin)}
            </span>
          </div>
          <div className="flex gap-2 pt-1">
            {amount >= 0.01 && (
              <button
                type="button"
                onClick={() => commit(0)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-[11px] font-black uppercase text-slate-600 hover:bg-slate-50"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={() => commit(amount)}
              className="flex-1 py-2.5 rounded-xl bg-slate-900 text-white text-[11px] font-black uppercase hover:bg-slate-800"
            >
              Save shipping
            </button>
          </div>
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
  onSaveShipping?: (amount: number) => void;
};

export const SaleProceedsTrigger: React.FC<TriggerProps> = ({
  item,
  breakdown,
  children,
  className,
  onDoubleClick,
  onSaveShipping,
}) => {
  const [open, setOpen] = useState(false);
  const [shippingOpen, setShippingOpen] = useState(false);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolved = breakdown ?? (item ? resolveSaleProceeds(item) : null);
  const canOpen = saleProceedsHasDetail(resolved);
  const shippingEditable = Boolean(item && onSaveShipping && canEditManualSellerShipping(item));

  useEffect(() => {
    return () => {
      if (clickTimer.current) clearTimeout(clickTimer.current);
    };
  }, []);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!shippingEditable && (!canOpen || !resolved)) return;
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => {
      if (shippingEditable) setShippingOpen(true);
      else setOpen(true);
    }, 220);
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
        title={
          shippingEditable
            ? 'Click to add shipping you paid · double-click to edit sell price'
            : canOpen
              ? 'Click for fees, shipping and payout'
              : undefined
        }
      >
        {children}
      </button>
      {open && resolved
        ? createPortal(<SaleProceedsDialog breakdown={resolved} onClose={() => setOpen(false)} />, document.body)
        : null}
      {shippingOpen && item && onSaveShipping
        ? createPortal(
            <SellerShippingEditorDialog
              item={item}
              onSave={onSaveShipping}
              onClose={() => setShippingOpen(false)}
            />,
            document.body
          )
        : null}
    </>
  );
};
