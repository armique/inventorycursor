import React from 'react';
import { HelpCircle, ShoppingCart, Ban, Tag, AlertTriangle } from 'lucide-react';
import type { ReinvestTodayBrief } from '../../utils/reinvestTodayBrief';
import type { ReinvestSuspicion } from '../../utils/reinvestSuspicion';
import { formatEURPrefix } from '../../utils/formatMoney';

type Props = {
  brief: ReinvestTodayBrief;
  onAnswer: (suspicion: ReinvestSuspicion, optionId: string) => void;
  onFocusGroup?: (key: string) => void;
  intentFilter: 'all' | 'standalone' | 'kit';
  onIntentFilterChange: (v: 'all' | 'standalone' | 'kit') => void;
};

const channelLabel = (c: 'ka' | 'ebay' | 'either') =>
  c === 'ka' ? 'Kleinanzeigen' : c === 'ebay' ? 'eBay' : 'Either channel';

const ReinvestTodayBriefPanel: React.FC<Props> = ({
  brief,
  onAnswer,
  onFocusGroup,
  intentFilter,
  onIntentFilterChange,
}) => {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-card overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-black text-slate-900 tracking-tight">Today</h2>
          <p className="text-[11px] font-semibold text-slate-400">
            Buy · skip · sell first · clarify when numbers look odd
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
          {(
            [
              ['all', 'All'],
              ['standalone', 'Parts'],
              ['kit', 'Kits'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => onIntentFilterChange(id)}
              className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider ${
                intentFilter === id ? 'bg-slate-900 text-white' : 'text-slate-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {brief.capitalNote && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 text-[11px] font-semibold text-amber-900 flex items-start gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          {brief.capitalNote}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-0 md:divide-x divide-slate-100">
        <section className="p-4 space-y-2">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-emerald-600 flex items-center gap-1.5">
            <ShoppingCart size={12} /> Buy
          </h3>
          {brief.buy.length === 0 ? (
            <p className="text-xs text-slate-400 font-semibold">Nothing urgent to restock.</p>
          ) : (
            brief.buy.map((row) => (
              <button
                key={row.group.key}
                type="button"
                onClick={() => onFocusGroup?.(row.group.key)}
                className="w-full text-left rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2 hover:border-slate-300 transition-colors"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-black text-slate-800 truncate">{row.group.label}</span>
                  <span className="text-xs font-black text-emerald-700 shrink-0">
                    {row.maxBuy != null ? `≤ ${formatEURPrefix(row.maxBuy)}` : '—'}
                  </span>
                </div>
                <p className="text-[10px] font-semibold text-slate-500 mt-0.5">
                  {channelLabel(row.channel)} · {row.why}
                  {row.gated ? ` · ${row.gated}` : ''}
                </p>
              </button>
            ))
          )}
        </section>

        <section className="p-4 space-y-2 border-t md:border-t-0 border-slate-100">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
            <Ban size={12} /> Don&apos;t buy
          </h3>
          {brief.skip.length === 0 ? (
            <p className="text-xs text-slate-400 font-semibold">No hard skips right now.</p>
          ) : (
            brief.skip.map((row) => (
              <div key={row.group.key} className="rounded-xl border border-slate-100 px-3 py-2">
                <p className="text-xs font-black text-slate-700 truncate">{row.group.label}</p>
                <p className="text-[10px] font-semibold text-slate-400 mt-0.5">{row.why}</p>
              </div>
            ))
          )}
        </section>
      </div>

      <div className="grid md:grid-cols-2 gap-0 border-t border-slate-100 md:divide-x divide-slate-100">
        <section className="p-4 space-y-2">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-violet-600 flex items-center gap-1.5">
            <Tag size={12} /> Sell first
          </h3>
          {brief.sell.length === 0 ? (
            <p className="text-xs text-slate-400 font-semibold">Stock looks fresh enough.</p>
          ) : (
            brief.sell.map((row) => (
              <div key={row.item.id} className="rounded-xl border border-slate-100 px-3 py-2">
                <p className="text-xs font-black text-slate-700 truncate">{row.item.name}</p>
                <p className="text-[10px] font-semibold text-slate-400 mt-0.5">{row.why}</p>
              </div>
            ))
          )}
        </section>

        <section className="p-4 space-y-2 border-t md:border-t-0 border-slate-100">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-amber-700 flex items-center gap-1.5">
            <HelpCircle size={12} /> Clarify
          </h3>
          {brief.clarify.length === 0 ? (
            <p className="text-xs text-slate-400 font-semibold">No open questions.</p>
          ) : (
            brief.clarify.map((q) => (
              <div key={q.id} className="rounded-xl border border-amber-100 bg-amber-50/50 px-3 py-2 space-y-2">
                <div>
                  <p className="text-xs font-black text-slate-800">{q.title}</p>
                  <p className="text-[10px] font-semibold text-slate-500 mt-0.5 leading-snug">{q.body}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {q.options.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => onAnswer(q, opt.id)}
                      className="px-2 py-1 rounded-lg bg-white border border-slate-200 text-[10px] font-bold text-slate-700 hover:border-slate-400"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
};

export default ReinvestTodayBriefPanel;
