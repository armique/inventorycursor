import React from 'react';
import type { EbayPurchaseRecord } from '../services/ebayPurchaseIndex';
import { formatPurchaseBuyDetailLines } from '../utils/ebayPurchaseToInventory';

/** Compact buy-details grid for purchase cards (platform, seller, price, date, order…). */
const PurchaseBuyInfoBlock: React.FC<{ purchase: EbayPurchaseRecord; className?: string }> = ({
  purchase,
  className = '',
}) => {
  const rows = formatPurchaseBuyDetailLines(purchase);
  if (!rows.length) return null;
  return (
    <div
      className={`rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5 ${className}`}
    >
      <p className="text-[9px] font-black uppercase tracking-wide text-slate-400 mb-1.5">Buying info</p>
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1.5">
        {rows.map((row) => (
          <div key={row.label} className="min-w-0">
            <dt className="text-[9px] font-bold uppercase text-slate-400">{row.label}</dt>
            <dd className="text-[11px] font-bold text-slate-800 truncate" title={row.value}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
};

export default PurchaseBuyInfoBlock;
