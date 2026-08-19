import React, { useState } from 'react';
import { History } from 'lucide-react';
import { ItemStatus, type InventoryItem } from '../types';
import { formatEUR } from '../utils/formatMoney';
import { formatSaleCycleSummary } from '../utils/itemSaleCycle';

function formatCycleDate(iso: string | undefined): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso.slice(0, 10);
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/** Compact timeline of closed eBay sales on this inventory row (refund → restock → resale). */
const SaleCycleHistory: React.FC<{ item: InventoryItem; compact?: boolean }> = ({ item, compact }) => {
  const cycles = item.ebaySaleCycles || [];
  const [open, setOpen] = useState(false);
  if (!cycles.length) return null;

  const latest = cycles[cycles.length - 1];
  const count = cycles.length;
  const label =
    item.status === ItemStatus.SOLD
      ? `Resold · ${count} prior eBay sale${count === 1 ? '' : 's'}`
      : `Returned ${count === 1 ? 'once' : `${count}×`} · last #${latest.ebayOrderId || '—'}`;

  return (
    <div className={compact ? 'mt-1' : 'mt-2'}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wide text-indigo-800 bg-indigo-50 border border-indigo-200 rounded-lg px-2 py-1 hover:bg-indigo-100"
        title={cycles.map(formatSaleCycleSummary).join('\n')}
      >
        <History size={10} className="shrink-0" />
        {label}
      </button>
      {open && (
        <ol className="mt-1.5 space-y-1.5 pl-0.5">
          {cycles.map((cycle, idx) => (
            <li
              key={cycle.id}
              className="text-[10px] leading-snug text-slate-700 bg-slate-50 border border-slate-100 rounded-lg px-2 py-1.5"
            >
              <p className="font-black text-slate-900">
                Sale {idx + 1} · {formatCycleDate(cycle.sellDate || cycle.closedAt)}
              </p>
              <p className="font-mono text-[9px] text-slate-600">
                {cycle.ebayOrderId ? `#${cycle.ebayOrderId}` : 'no order id'}
                {cycle.customer?.name ? ` · ${cycle.customer.name}` : ''}
                {cycle.ebayUsername ? ` · @${cycle.ebayUsername}` : ''}
              </p>
              <p>
                {cycle.sellPrice != null ? `€${formatEUR(cycle.sellPrice)}` : '—'}
                {cycle.saleProceeds?.netPayoutEur != null
                  ? ` · net €${formatEUR(cycle.saleProceeds.netPayoutEur)}`
                  : ''}
                {cycle.leftoverLossEur != null && cycle.leftoverLossEur >= 0.01
                  ? ` · leftover +€${formatEUR(cycle.leftoverLossEur)} EK`
                  : ''}
              </p>
              <p className="text-indigo-800 font-bold">{cycle.reasonLabel}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

export default SaleCycleHistory;
