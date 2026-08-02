import React, { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
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

const channelShort = (c: 'ka' | 'ebay' | 'either') =>
  c === 'ka' ? 'KA' : c === 'ebay' ? 'eBay' : 'Any';

const ReinvestTodayBriefPanel: React.FC<Props> = ({
  brief,
  onAnswer,
  onFocusGroup,
  intentFilter,
  onIntentFilterChange,
}) => {
  const [clarifyOpen, setClarifyOpen] = useState(brief.clarify.length > 0);
  const hero = brief.buy[0];

  return (
    <div className="rx-panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[var(--rx-line)]">
        <h2 className="text-[15px] font-semibold tracking-tight text-[var(--rx-ink)]">Today</h2>
        <div className="rx-seg" role="group" aria-label="Filter">
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
              aria-pressed={intentFilter === id}
              onClick={() => onIntentFilterChange(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {brief.capitalNote && (
        <div className="px-4 py-2.5 bg-[var(--rx-warn-soft)] text-[12px] font-medium text-[var(--rx-warn)] flex items-center gap-2">
          <AlertTriangle size={14} className="shrink-0" />
          <span className="truncate">{brief.capitalNote}</span>
        </div>
      )}

      {/* Hero buy — one glance */}
      <div className="px-4 pt-4 pb-3">
        {hero ? (
          <button
            type="button"
            onClick={() => onFocusGroup?.(hero.group.key)}
            className="w-full text-left rounded-2xl bg-[var(--rx-ink)] text-white p-4 transition-transform active:scale-[0.995]"
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-[11px] font-medium text-white/60">Top buy</span>
              <span className="rx-pill bg-white/10 text-white/80 border-0">{channelShort(hero.channel)}</span>
            </div>
            <p className="text-[17px] font-semibold tracking-tight truncate">{hero.group.label}</p>
            <div className="mt-3 flex items-end justify-between gap-3">
              <div>
                <p className="text-[11px] text-white/55">Max buy</p>
                <p className="rx-num text-[28px] font-semibold leading-none tracking-tight">
                  {hero.maxBuy != null ? formatEURPrefix(hero.maxBuy) : '—'}
                </p>
              </div>
              <p className="text-[12px] text-white/65 text-right max-w-[55%] leading-snug">
                {hero.gated || `~€${hero.group.profitPerDay.toFixed(0)}/day · ${Math.round(hero.group.avgDaysToSell)}d`}
              </p>
            </div>
          </button>
        ) : (
          <div className="rounded-2xl bg-[var(--rx-soft)] p-4">
            <p className="text-[13px] font-medium text-[var(--rx-muted)]">Nothing urgent to buy</p>
          </div>
        )}
      </div>

      {/* Three compact columns — labels only */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-[var(--rx-line)] border-t border-[var(--rx-line)]">
        <section className="bg-white p-3 space-y-1.5">
          <p className="text-[11px] font-medium text-[var(--rx-ok)] px-1">Buy</p>
          {brief.buy.length === 0 ? (
            <p className="rx-muted text-[12px] px-1 py-2">—</p>
          ) : (
            brief.buy.slice(0, 4).map((row) => (
              <button
                key={row.group.key}
                type="button"
                className="rx-row"
                onClick={() => onFocusGroup?.(row.group.key)}
              >
                <span className="text-[12px] font-medium truncate min-w-0">{row.group.label}</span>
                <span className="rx-num text-[12px] font-semibold text-[var(--rx-ok)] shrink-0">
                  {row.maxBuy != null ? formatEURPrefix(row.maxBuy) : '—'}
                </span>
              </button>
            ))
          )}
        </section>

        <section className="bg-white p-3 space-y-1.5">
          <p className="text-[11px] font-medium text-[var(--rx-muted)] px-1">Skip</p>
          {brief.skip.length === 0 ? (
            <p className="rx-muted text-[12px] px-1 py-2">—</p>
          ) : (
            brief.skip.slice(0, 4).map((row) => (
              <div key={row.group.key} className="rx-row cursor-default">
                <span className="text-[12px] font-medium truncate min-w-0">{row.group.label}</span>
                <span className="rx-pill rx-pill-bad shrink-0">skip</span>
              </div>
            ))
          )}
        </section>

        <section className="bg-white p-3 space-y-1.5">
          <p className="text-[11px] font-medium text-[var(--rx-ink)] px-1">Sell</p>
          {brief.sell.length === 0 ? (
            <p className="rx-muted text-[12px] px-1 py-2">—</p>
          ) : (
            brief.sell.slice(0, 4).map((row) => (
              <div key={row.item.id} className="rx-row cursor-default">
                <span className="text-[12px] font-medium truncate min-w-0">{row.item.name}</span>
                <span className="rx-num text-[11px] font-semibold text-[var(--rx-muted)] shrink-0">
                  {row.ageDays}d
                </span>
              </div>
            ))
          )}
        </section>
      </div>

      {/* Clarify — collapsed by default if answered elsewhere; open when questions exist */}
      {brief.clarify.length > 0 && (
        <div className="border-t border-[var(--rx-line)]">
          <button
            type="button"
            onClick={() => setClarifyOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-left"
          >
            <span className="text-[13px] font-medium flex items-center gap-2">
              Clarify
              <span className="rx-pill rx-pill-warn">{brief.clarify.length}</span>
            </span>
            {clarifyOpen ? <ChevronDown size={16} className="text-[var(--rx-muted)]" /> : <ChevronRight size={16} className="text-[var(--rx-muted)]" />}
          </button>
          {clarifyOpen && (
            <div className="px-4 pb-4 space-y-2">
              {brief.clarify.map((q) => (
                <div key={q.id} className="rounded-xl border border-[var(--rx-line)] bg-[var(--rx-soft)] p-3">
                  <p className="text-[13px] font-semibold tracking-tight">{q.title}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {q.options.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => onAnswer(q, opt.id)}
                        className="px-2.5 py-1.5 rounded-lg bg-white border border-[var(--rx-line)] text-[11px] font-medium hover:border-[var(--rx-ink)] transition-colors"
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ReinvestTodayBriefPanel;
