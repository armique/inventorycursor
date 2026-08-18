import React, { useMemo, useState } from 'react';
import { ChevronDown, Layers } from 'lucide-react';
import type { InventoryItem } from '../types';
import { formatEUR } from '../utils/formatMoney';
import {
  costAllocationMethodLabel,
  resolveCostOrigin,
} from '../utils/costOrigin';

type Props = {
  item: InventoryItem;
  allItems?: InventoryItem[] | null;
};

const CostOriginPanel: React.FC<Props> = ({ item, allItems }) => {
  const [open, setOpen] = useState(true);
  const origin = useMemo(() => resolveCostOrigin(item, allItems || []), [item, allItems]);
  const currentBuy = Number(item.buyPrice) || 0;
  const originalBuy = Number(origin.allocatedEur) || 0;
  const changed = Math.abs(currentBuy - originalBuy) >= 0.01;
  const siblings = origin.siblings || [];
  const captured = origin.capturedAt
    ? new Date(origin.capturedAt).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
    : '';

  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50/80 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left"
      >
        <Layers size={13} className="text-slate-500 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-[9px] font-black uppercase tracking-wider text-slate-400">
            Why this price
          </span>
          <span className="block text-[11px] font-bold text-slate-800 truncate">
            {origin.label}
          </span>
        </span>
        <ChevronDown
          size={14}
          className={`text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="px-2.5 pb-2.5 space-y-2 text-[11px] text-slate-700">
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
            <dt className="text-slate-400 font-bold uppercase tracking-wide text-[9px]">Added as</dt>
            <dd className="font-semibold">{origin.addedAs}</dd>
            {origin.bundleName ? (
              <>
                <dt className="text-slate-400 font-bold uppercase tracking-wide text-[9px]">Bundle</dt>
                <dd className="font-semibold">{origin.bundleName}</dd>
              </>
            ) : null}
            {origin.sourceItemName ? (
              <>
                <dt className="text-slate-400 font-bold uppercase tracking-wide text-[9px]">From</dt>
                <dd className="font-semibold">{origin.sourceItemName}</dd>
              </>
            ) : null}
            <dt className="text-slate-400 font-bold uppercase tracking-wide text-[9px]">Parts</dt>
            <dd className="font-semibold">
              {origin.partCount} in lot · this share {origin.weightSharePct ?? 0}%
            </dd>
            <dt className="text-slate-400 font-bold uppercase tracking-wide text-[9px]">Lot total</dt>
            <dd className="font-semibold tabular-nums">€{formatEUR(origin.lotTotalEur)}</dd>
            <dt className="text-slate-400 font-bold uppercase tracking-wide text-[9px]">This part</dt>
            <dd className="font-semibold tabular-nums">
              €{formatEUR(originalBuy)}
              {changed ? (
                <span className="ml-1 text-amber-700 font-bold">
                  (now €{formatEUR(currentBuy)})
                </span>
              ) : null}
            </dd>
            <dt className="text-slate-400 font-bold uppercase tracking-wide text-[9px]">Split</dt>
            <dd className="font-semibold">
              {costAllocationMethodLabel(origin.allocationMethod)}
              {origin.manualLocked ? ' · locked' : ''}
              {captured ? ` · ${captured}` : ''}
            </dd>
          </dl>
          {siblings.length > 1 ? (
            <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
              <p className="px-2 py-1 text-[9px] font-black uppercase tracking-wider text-slate-400 bg-slate-50">
                Bundle parts at add
              </p>
              <ul className="max-h-40 overflow-y-auto divide-y divide-slate-100">
                {siblings.map((row, idx) => {
                  const isSelf = row.id === item.id || row.name === item.name;
                  return (
                    <li
                      key={`${row.id || row.name}-${idx}`}
                      className={`flex items-baseline justify-between gap-2 px-2 py-1 ${
                        isSelf ? 'bg-emerald-50 font-bold text-emerald-900' : ''
                      }`}
                    >
                      <span className="min-w-0 truncate">{row.name}</span>
                      <span className="tabular-nums shrink-0">€{formatEUR(row.allocatedEur)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          {origin.notes ? (
            <p className="text-[10px] leading-relaxed text-slate-500">{origin.notes}</p>
          ) : null}
        </div>
      )}
    </section>
  );
};

export default CostOriginPanel;
