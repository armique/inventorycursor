import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronDown,
  ChevronRight,
  CircuitBoard,
  Cpu,
  ExternalLink,
  Flame,
  Gauge,
  Lightbulb,
  Pencil,
  ShoppingCart,
  Trophy,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import type { BusinessSettings, InventoryItem, ItemUpdateOptions } from '../types';
import { formatEUR } from '../utils/formatMoney';
import {
  analyzeCpuMoboCombos,
  analyzeComboRebuys,
  type ComboDateRange,
  type ComboKindFilter,
  type ComboRebuyNeed,
  type ComboSortMode,
  type CpuMoboComboRow,
  type SkippedComboKit,
} from '../utils/cpuMoboComboAnalytics';
import { getContainerKindLabel } from '../utils/containerMembership';

interface Props {
  items: InventoryItem[];
  businessSettings: BusinessSettings;
  onUpdate?: (items: InventoryItem[], deleteIds?: string[], options?: ItemUpdateOptions) => void;
}

const DATE_OPTIONS: { id: ComboDateRange; label: string }[] = [
  { id: 'ALL', label: 'All time' },
  { id: 'LAST_90', label: 'Last 90d' },
  { id: 'LAST_180', label: 'Last 180d' },
  { id: 'THIS_YEAR', label: 'This year' },
  { id: 'LAST_YEAR', label: 'Last year' },
];

const KIND_OPTIONS: { id: ComboKindFilter; label: string }[] = [
  { id: 'ALL', label: 'All kits' },
  { id: 'pc', label: 'PC builds' },
  { id: 'bundle', label: 'Bundles' },
  { id: 'mixed', label: 'Mixed' },
];

const SORT_OPTIONS: { id: ComboSortMode; label: string }[] = [
  { id: 'eurPerDay', label: '€ / day' },
  { id: 'fastest', label: 'Fastest' },
  { id: 'profit', label: 'Avg profit' },
  { id: 'margin', label: 'Margin %' },
  { id: 'volume', label: 'Most sold' },
];

function daysLabel(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${Math.round(n)}d`;
}

function pctLabel(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${Math.round(n)}%`;
}

const ComboLabPage: React.FC<Props> = ({ items, businessSettings, onUpdate }) => {
  const [dateRange, setDateRange] = useState<ComboDateRange>('ALL');
  const [kind, setKind] = useState<ComboKindFilter>('ALL');
  const [sort, setSort] = useState<ComboSortMode>('eurPerDay');
  const [minSold, setMinSold] = useState(1);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showSkipped, setShowSkipped] = useState(false);
  const [expandedSkippedId, setExpandedSkippedId] = useState<string | null>(null);
  const [actionToast, setActionToast] = useState<string | null>(null);

  const taxMode = businessSettings.taxMode || 'SmallBusiness';

  const summary = useMemo(
    () =>
      analyzeCpuMoboCombos(items, taxMode, {
        dateRange,
        kind,
        minSold,
        sort,
      }),
    [items, taxMode, dateRange, kind, minSold, sort]
  );

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return summary.rows;
    return summary.rows.filter((r) => {
      const hay = `${r.label} ${r.cpuLabel} ${r.moboLabel} ${r.socket}`.toLowerCase();
      return hay.includes(q);
    });
  }, [summary.rows, query]);

  const rebuyAnalysis = useMemo(
    () => analyzeComboRebuys(items, summary.rows, { limit: 8 }),
    [items, summary.rows]
  );
  const rebuySuggestions = rebuyAnalysis.suggestions;

  const markChildRole = (childId: string, role: 'cpu' | 'mobo') => {
    if (!onUpdate) return;
    const child = items.find((i) => i.id === childId);
    if (!child) return;
    const patch: InventoryItem = {
      ...child,
      category: 'Components',
      subCategory: role === 'cpu' ? 'Processors' : 'Motherboards',
    };
    onUpdate([patch], undefined, { flushCloud: true });
    setActionToast(
      role === 'cpu'
        ? `Marked “${child.name}” as Processor — combo list will refresh`
        : `Marked “${child.name}” as Motherboard — combo list will refresh`
    );
    window.setTimeout(() => setActionToast(null), 2800);
  };

  return (
    <div className="w-full px-3 sm:px-4 md:px-5 pb-24 md:pb-6 animate-in fade-in space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <CircuitBoard size={22} className="text-indigo-700 shrink-0" />
            Combo Lab
          </h1>
          <p className="text-xs text-slate-500">
            Which CPU + motherboard pairs in your sold PCs/bundles flip fastest and make the most
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/panel/flip-coach"
            className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase text-sky-700 hover:text-sky-900"
          >
            Flip Coach
          </Link>
          <Link
            to="/panel/builder"
            className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase text-indigo-700 hover:text-indigo-900"
          >
            Builder
          </Link>
        </div>
      </header>

      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value as ComboDateRange)}
          className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700"
        >
          {DATE_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as ComboKindFilter)}
          className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700"
        >
          {KIND_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as ComboSortMode)}
          className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              Sort: {o.label}
            </option>
          ))}
        </select>
        <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
          Min sold
          <input
            type="number"
            min={1}
            max={50}
            value={minSold}
            onChange={(e) => setMinSold(Math.max(1, Number(e.target.value) || 1))}
            className="w-14 px-1.5 py-1 rounded-lg border border-slate-200 text-xs font-bold"
          />
        </label>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter socket, CPU, board…"
          className="flex-1 min-w-[10rem] px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold"
        />
      </div>

      <section className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-3 space-y-2.5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-xs font-black uppercase tracking-widest text-amber-900 flex items-center gap-1.5">
                <Lightbulb size={14} /> Rebuy / build next
              </h2>
              <p className="text-[11px] font-semibold text-amber-800/80 mt-0.5">
                Based on your sold combo stats vs free CPUs and boards in active stock
              </p>
            </div>
            <Link
              to="/panel/builder"
              className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-amber-900 hover:underline shrink-0"
            >
              <Wrench size={12} /> Builder
            </Link>
          </div>
          {rebuySuggestions.length === 0 ? (
            <p className="text-[11px] font-semibold text-amber-900/80 rounded-lg border border-amber-100 bg-white/80 px-3 py-2.5">
              No rebuy tips right now.
              {` ${rebuyAnalysis.freeCpuTotal} free CPU${rebuyAnalysis.freeCpuTotal === 1 ? '' : 's'}, ${rebuyAnalysis.freeMoboTotal} free board${rebuyAnalysis.freeMoboTotal === 1 ? '' : 's'}`}
              {rebuyAnalysis.combosWithNoStock > 0
                ? `, ${rebuyAnalysis.combosWithNoStock} profitable combo${rebuyAnalysis.combosWithNoStock === 1 ? '' : 's'} with 0 kits in stock`
                : ''}
              . Tips appear when you have orphan parts for a proven combo, both parts loose to assemble, or a top combo with nothing in stock.
            </p>
          ) : (
            <ul className="space-y-2">
              {rebuySuggestions.map((s) => (
                <li
                  key={`${s.comboKey}-${s.need}`}
                  className="rounded-lg border border-amber-100 bg-white p-2.5 flex flex-wrap gap-2 items-start"
                >
                  <NeedBadge need={s.need} />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-sm font-black text-slate-900 leading-snug">{s.title}</p>
                    <p className="text-[11px] font-semibold text-slate-600 leading-snug">{s.reason}</p>
                    <p className="text-[10px] font-bold text-slate-400">
                      {s.socket} · {s.soldCount}× sold · avg €{formatEUR(s.avgProfit)}
                      {s.eurPerDay != null ? ` · €${formatEUR(s.eurPerDay)}/d` : ''}
                      {s.avgDaysToSell != null ? ` · ${Math.round(s.avgDaysToSell)}d` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5 shrink-0">
                    {s.need === 'assemble' ? (
                      <Link
                        to="/panel/builder"
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-[10px] font-black uppercase"
                      >
                        <Wrench size={12} /> Assemble
                      </Link>
                    ) : (
                      <Link
                        to={`/panel/inventory?q=${encodeURIComponent(s.searchQuery.slice(0, 48))}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-950 text-[10px] font-black uppercase"
                      >
                        <ShoppingCart size={12} /> Check stock
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Kpi
          icon={<Zap size={14} className="text-amber-600" />}
          label="Best €/day"
          value={summary.topEurPerDay ? `€${formatEUR(summary.topEurPerDay.eurPerDay || 0)}` : '—'}
          sub={summary.topEurPerDay?.label}
        />
        <Kpi
          icon={<Gauge size={14} className="text-emerald-600" />}
          label="Fastest"
          value={daysLabel(summary.fastest?.avgDaysToSell)}
          sub={summary.fastest?.label}
        />
        <Kpi
          icon={<Trophy size={14} className="text-violet-600" />}
          label="Top avg profit"
          value={summary.topProfit ? `€${formatEUR(summary.topProfit.avgProfit)}` : '—'}
          sub={summary.topProfit?.label}
        />
        <Kpi
          icon={<Flame size={14} className="text-rose-600" />}
          label="Most sold"
          value={summary.mostSold ? `${summary.mostSold.soldCount}×` : '—'}
          sub={summary.mostSold?.label}
        />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-3 flex flex-wrap gap-4 text-[11px] font-semibold text-slate-600">
        <span>
          <strong className="text-slate-900">{summary.soldKitsWithCpuMobo}</strong> sold kits with
          CPU+board
        </span>
        <span>
          <strong className="text-slate-900">{summary.uniqueCombos}</strong> unique combos
        </span>
        <span>
          Avg flip <strong className="text-slate-900">{daysLabel(summary.avgDaysToSell)}</strong>
        </span>
        <span>
          Total profit{' '}
          <strong className="text-emerald-700">€{formatEUR(summary.totalProfit)}</strong>
        </span>
        {summary.skippedMissingPair > 0 && (
          <button
            type="button"
            onClick={() => {
              setShowSkipped((v) => !v);
              if (showSkipped) setExpandedSkippedId(null);
            }}
            className={`inline-flex items-center gap-1 underline-offset-2 hover:underline ${
              showSkipped ? 'text-amber-800 font-bold' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            {summary.skippedMissingPair} sold kits skipped (no CPU+board pair)
            {showSkipped ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        )}
      </section>

      {actionToast && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-900">
          {actionToast}
        </div>
      )}

      {showSkipped && summary.skippedKits.length > 0 && (
        <SkippedKitsPanel
          kits={summary.skippedKits}
          expandedId={expandedSkippedId}
          onToggle={(id) => setExpandedSkippedId((cur) => (cur === id ? null : id))}
          onClose={() => {
            setShowSkipped(false);
            setExpandedSkippedId(null);
          }}
          onMarkRole={onUpdate ? markChildRole : undefined}
        />
      )}

      {filteredRows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-10 text-center">
          <Cpu size={36} className="mx-auto mb-3 text-slate-300" />
          <p className="font-bold text-slate-500">No CPU + motherboard combos yet</p>
          <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
            Sold PCs and bundles need both a processor and a motherboard as components. Build kits
            in Builder, then sell them — results show up here.
          </p>
          <Link
            to="/panel/builder"
            className="inline-flex mt-4 px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold"
          >
            Open Builder
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Desktop table */}
          <div className="hidden md:block rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-100 text-[10px] font-black uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-3 py-2 w-8" />
                  <th className="px-3 py-2">Combo</th>
                  <th className="px-3 py-2 text-right">Sold</th>
                  <th className="px-3 py-2 text-right">Avg days</th>
                  <th className="px-3 py-2 text-right">Avg profit</th>
                  <th className="px-3 py-2 text-right">Margin</th>
                  <th className="px-3 py-2 text-right">€/day</th>
                  <th className="px-3 py-2 text-right">In stock</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredRows.map((row) => (
                  <ComboTableRows
                    key={row.comboKey}
                    row={row}
                    expanded={expandedKey === row.comboKey}
                    onToggle={() =>
                      setExpandedKey((cur) => (cur === row.comboKey ? null : row.comboKey))
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {filteredRows.map((row) => {
              const open = expandedKey === row.comboKey;
              return (
                <div
                  key={row.comboKey}
                  className="rounded-xl border border-slate-200 bg-white overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedKey((cur) => (cur === row.comboKey ? null : row.comboKey))
                    }
                    className="w-full text-left p-3 space-y-1.5"
                  >
                    <div className="flex items-start gap-2">
                      {open ? (
                        <ChevronDown size={16} className="text-slate-400 mt-0.5 shrink-0" />
                      ) : (
                        <ChevronRight size={16} className="text-slate-400 mt-0.5 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-black uppercase text-indigo-700">
                          {row.socket}
                        </p>
                        <p className="font-bold text-slate-900 text-sm leading-snug">
                          {row.cpuLabel}
                        </p>
                        <p className="text-xs font-semibold text-slate-500">{row.moboLabel}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-black text-emerald-700">
                          €{formatEUR(row.avgProfit)}
                        </p>
                        <p className="text-[10px] font-bold text-slate-400">
                          {daysLabel(row.avgDaysToSell)} · {row.soldCount}×
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 pl-6">
                      <Pill>{pctLabel(row.avgMarginPct)} margin</Pill>
                      <Pill>
                        €{formatEUR(row.eurPerDay ?? 0)}
                        /d
                      </Pill>
                      {row.inStockCount > 0 && (
                        <Pill tone="amber">{row.inStockCount} in stock</Pill>
                      )}
                    </div>
                  </button>
                  {open && <SampleList row={row} />}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

function SkippedKitsPanel({
  kits,
  expandedId,
  onToggle,
  onClose,
  onMarkRole,
}: {
  kits: SkippedComboKit[];
  expandedId: string | null;
  onToggle: (id: string) => void;
  onClose: () => void;
  onMarkRole?: (childId: string, role: 'cpu' | 'mobo') => void;
}) {
  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/60 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-amber-200/80">
        <div className="min-w-0">
          <h2 className="text-xs font-black uppercase tracking-widest text-amber-950">
            Skipped sold kits
          </h2>
          <p className="text-[11px] font-semibold text-amber-900/70">
            No detected CPU+board pair. If a part was miscategorized, mark it below.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg text-amber-800 hover:bg-amber-100"
          aria-label="Close skipped list"
        >
          <X size={16} />
        </button>
      </div>
      <ul className="divide-y divide-amber-100 max-h-[28rem] overflow-y-auto bg-white/80">
        {kits.map((kit) => {
          const open = expandedId === kit.containerId;
          return (
            <li key={kit.containerId}>
              <button
                type="button"
                onClick={() => onToggle(kit.containerId)}
                className="w-full text-left px-3 py-2.5 flex items-start gap-2 hover:bg-amber-50/80"
              >
                {open ? (
                  <ChevronDown size={16} className="text-slate-400 mt-0.5 shrink-0" />
                ) : (
                  <ChevronRight size={16} className="text-slate-400 mt-0.5 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-900 truncate">{kit.containerName}</p>
                  <p className="text-[11px] font-semibold text-slate-500">
                    {kit.kind ? getContainerKindLabel(kit.kind) : 'Kit'}
                    {kit.sellDate ? ` · sold ${kit.sellDate}` : ''}
                    {` · ${kit.children.length} part${kit.children.length === 1 ? '' : 's'}`}
                  </p>
                </div>
                <span className="shrink-0 px-1.5 py-0.5 rounded-md text-[9px] font-black uppercase border bg-amber-50 text-amber-900 border-amber-200">
                  {kit.reasonLabel}
                </span>
              </button>
              {open && (
                <div className="px-3 pb-3 pl-9 space-y-2 bg-slate-50/80">
                  <div className="flex flex-wrap gap-1.5">
                    <Link
                      to={`/panel/edit/${encodeURIComponent(kit.containerId)}`}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 text-white text-[10px] font-black uppercase"
                    >
                      <Pencil size={11} /> Edit kit
                    </Link>
                    <Link
                      to={`/panel/inventory?q=${encodeURIComponent(kit.containerName.slice(0, 40))}`}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-700 text-[10px] font-black uppercase"
                    >
                      <ExternalLink size={11} /> Inventory
                    </Link>
                  </div>
                  {kit.children.length === 0 ? (
                    <p className="text-[11px] font-semibold text-slate-500">
                      No linked components — open the kit and attach CPU + motherboard parts.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {kit.children.map((child) => (
                        <li
                          key={child.id}
                          className="rounded-lg border border-slate-200 bg-white p-2 flex flex-wrap gap-2 items-start"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-bold text-slate-800 truncate">{child.name}</p>
                            <p className="text-[10px] font-semibold text-slate-400">
                              {child.category}
                              {child.subCategory ? ` / ${child.subCategory}` : ''}
                              {' · '}
                              {child.detectedAs === 'cpu'
                                ? 'detected as CPU'
                                : child.detectedAs === 'mobo'
                                  ? 'detected as board'
                                  : 'not detected as CPU/board'}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            <Link
                              to={`/panel/edit/${encodeURIComponent(child.id)}`}
                              className="px-1.5 py-1 rounded-md border border-slate-200 text-[9px] font-black uppercase text-slate-600 hover:bg-slate-50"
                            >
                              Edit
                            </Link>
                            {onMarkRole && child.detectedAs !== 'cpu' && (
                              <button
                                type="button"
                                onClick={() => onMarkRole(child.id, 'cpu')}
                                className="px-1.5 py-1 rounded-md border border-sky-200 bg-sky-50 text-[9px] font-black uppercase text-sky-800 hover:bg-sky-100"
                              >
                                Mark as CPU
                              </button>
                            )}
                            {onMarkRole && child.detectedAs !== 'mobo' && (
                              <button
                                type="button"
                                onClick={() => onMarkRole(child.id, 'mobo')}
                                className="px-1.5 py-1 rounded-md border border-violet-200 bg-violet-50 text-[9px] font-black uppercase text-violet-800 hover:bg-violet-100"
                              >
                                Mark as board
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function NeedBadge({ need }: { need: ComboRebuyNeed }) {
  const map: Record<ComboRebuyNeed, { label: string; cls: string }> = {
    assemble: { label: 'Assemble', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
    cpu: { label: 'Need CPU', cls: 'bg-sky-50 text-sky-800 border-sky-200' },
    mobo: { label: 'Need board', cls: 'bg-violet-50 text-violet-800 border-violet-200' },
    both: { label: 'Restock', cls: 'bg-rose-50 text-rose-800 border-rose-200' },
  };
  const m = map[need];
  return (
    <span
      className={`inline-flex px-1.5 py-0.5 rounded-md text-[9px] font-black uppercase border shrink-0 ${m.cls}`}
    >
      {m.label}
    </span>
  );
}

function Kpi({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 min-w-0">
      <p className="text-[9px] font-black uppercase text-slate-400 flex items-center gap-1 truncate">
        {icon} {label}
      </p>
      <p className="text-lg font-black text-slate-900 truncate">{value}</p>
      {sub && <p className="text-[10px] font-semibold text-slate-500 truncate" title={sub}>{sub}</p>}
    </div>
  );
}

function Pill({
  children,
  tone = 'slate',
}: {
  children: React.ReactNode;
  tone?: 'slate' | 'amber';
}) {
  const cls =
    tone === 'amber'
      ? 'bg-amber-50 text-amber-800 border-amber-200'
      : 'bg-slate-50 text-slate-600 border-slate-200';
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded-md text-[10px] font-bold border ${cls}`}>
      {children}
    </span>
  );
}

function ComboTableRows({
  row,
  expanded,
  onToggle,
}: {
  row: CpuMoboComboRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="hover:bg-slate-50/80">
        <td className="px-2 py-2">
          <button
            type="button"
            onClick={onToggle}
            className="p-1 rounded text-slate-400 hover:text-slate-700"
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        </td>
        <td className="px-3 py-2 min-w-0">
          <p className="text-[10px] font-black uppercase text-indigo-700">{row.socket}</p>
          <p className="font-bold text-slate-900 truncate">
            {row.cpuLabel} <span className="text-slate-300 font-normal">+</span> {row.moboLabel}
          </p>
          <p className="text-[10px] text-slate-400 font-semibold">
            {row.kinds.map(getContainerKindLabel).join(' · ')}
          </p>
        </td>
        <td className="px-3 py-2 text-right font-black text-slate-800">{row.soldCount}</td>
        <td className="px-3 py-2 text-right font-bold text-slate-700">
          {daysLabel(row.avgDaysToSell)}
          {row.medianDaysToSell != null && (
            <span className="block text-[10px] font-semibold text-slate-400">
              med {daysLabel(row.medianDaysToSell)}
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-right font-black text-emerald-700">
          €{formatEUR(row.avgProfit)}
          <span className="block text-[10px] font-semibold text-slate-400">
            tot €{formatEUR(row.totalProfit)}
          </span>
        </td>
        <td className="px-3 py-2 text-right font-bold text-slate-700">
          {pctLabel(row.avgMarginPct)}
        </td>
        <td className="px-3 py-2 text-right font-black text-amber-700">
          {row.eurPerDay != null ? `€${formatEUR(row.eurPerDay)}` : '—'}
        </td>
        <td className="px-3 py-2 text-right font-bold text-slate-600">
          {row.inStockCount > 0 ? row.inStockCount : '—'}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} className="bg-slate-50/80 px-3 py-2">
            <SampleList row={row} />
          </td>
        </tr>
      )}
    </>
  );
}

function SampleList({ row }: { row: CpuMoboComboRow }) {
  return (
    <div className="space-y-1.5 px-1 pb-2">
      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 px-2 pt-1">
        Sold kits in this combo
      </p>
      <ul className="space-y-1">
        {row.samples.map((s) => (
          <li
            key={s.containerId}
            className="flex flex-wrap items-center gap-2 px-2 py-1.5 rounded-lg bg-white border border-slate-100 text-xs"
          >
            <span className="font-bold text-slate-800 truncate flex-1 min-w-[8rem]">
              {s.containerName}
            </span>
            <span className="text-slate-400 font-semibold">{getContainerKindLabel(s.kind)}</span>
            <span className="text-slate-500">{s.sellDate || '—'}</span>
            <span className="font-bold text-slate-600">{daysLabel(s.daysToSell)}</span>
            <span className="font-black text-emerald-700">€{formatEUR(s.profit)}</span>
            <Link
              to={`/panel/inventory?q=${encodeURIComponent(s.containerName.slice(0, 40))}`}
              className="inline-flex items-center gap-0.5 text-indigo-700 font-bold hover:underline"
            >
              Stock <ExternalLink size={11} />
            </Link>
          </li>
        ))}
      </ul>
      {row.inStockCount > 0 && (
        <p className="text-[11px] font-semibold text-amber-800 px-2">
          {row.inStockCount} similar kit{row.inStockCount === 1 ? '' : 's'} still in stock — good
          signal to list soon if this combo flips well.
        </p>
      )}
    </div>
  );
}

export default ComboLabPage;
