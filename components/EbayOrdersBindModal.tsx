import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ShoppingCart, X } from 'lucide-react';
import type { InventoryItem, TaxMode } from '../types';
import EbayOrdersPage from './EbayOrdersPage';

type Props = {
  items: InventoryItem[];
  taxMode: TaxMode;
  onUpdate: (items: InventoryItem[]) => void;
  onClose: () => void;
  /** Called after a bind. remainingOpen === 0 means the queue is done. */
  onBound?: (updated: InventoryItem, remainingOpen: number) => void;
};

const EbayOrdersBindModal: React.FC<Props> = ({ items, taxMode, onUpdate, onClose, onBound }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[240] flex items-center justify-center bg-slate-900/55 backdrop-blur-sm p-3"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Bind eBay orders"
    >
      <div
        className="bg-white w-full max-w-2xl h-[min(90vh,740px)] rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-slate-100">
          <ShoppingCart size={16} className="text-slate-700" />
          <h2 className="text-sm font-black text-slate-900">eBay Orders</h2>
          <p className="hidden sm:block text-[11px] text-slate-500 font-semibold truncate">
            Bind stock → sold. Window closes when none are left.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-800"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 min-h-0">
          <EbayOrdersPage
            embedded
            items={items}
            taxMode={taxMode}
            onUpdate={onUpdate}
            onBound={onBound}
          />
        </div>
      </div>
    </div>,
    document.body
  );
};

export default EbayOrdersBindModal;
