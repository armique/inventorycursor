import React, { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ShieldAlert, PiggyBank, AlertTriangle, Download, Clock, TrendingUp } from 'lucide-react';
import type { Expense, InventoryItem, TaxMode } from '../../types';
import type { ReinvestData } from '../../utils/reinvestAnalysis';
import {
  computeAdvisorSplitPct,
  computeAvgMonthlyProfit,
  computeBreakEvenTimers,
  computeConcentrationWarning,
  effectiveBankSplitPct,
  simulateGrowth,
  suggestCushionGoal,
  loadCapitalPlanningState,
  saveCapitalPlanningState,
  type CapitalPlanningState,
} from '../../utils/financialPlanning';
import { buildTradeHistoryCsv, downloadCsv } from '../../utils/tradeExport';
import { formatEURPrefix } from '../../utils/formatMoney';

type Props = {
  items: InventoryItem[];
  expenses: Expense[];
  taxMode: TaxMode;
  reinvestData: ReinvestData;
};

const STATUS_STYLE: Record<string, string> = {
  within: 'bg-emerald-500',
  approaching: 'bg-amber-500',
  overdue: 'bg-rose-500',
};

const ReinvestAdvisorTab: React.FC<Props> = ({ items, expenses, taxMode, reinvestData }) => {
  const [planning, setPlanning] = useState<CapitalPlanningState>(() => loadCapitalPlanningState());
  const effectivePct = effectiveBankSplitPct(planning);
  const suggestedCushion = useMemo(() => suggestCushionGoal(expenses), [expenses]);
  const concentration = useMemo(() => computeConcentrationWarning(items), [items]);
  const avgMonthlyProfit = useMemo(() => computeAvgMonthlyProfit(items, expenses, taxMode), [items, expenses, taxMode]);
  const breakEvenTimers = useMemo(() => computeBreakEvenTimers(items, reinvestData.variants), [items, reinvestData.variants]);

  const [cushionInput, setCushionInput] = useState<string>(String(planning.cushionGoalAmount || suggestedCushion));
  const [simPct, setSimPct] = useState<number>(effectivePct);
  const [simHorizon, setSimHorizon] = useState<6 | 12 | 24>(12);

  const cushionFilledPct = planning.cushionGoalAmount > 0
    ? Math.min(100, Math.round((planning.bankBalance / planning.cushionGoalAmount) * 100))
    : 0;

  const projection = useMemo(
    () => simulateGrowth(planning.bankBalance, planning.circulationBalance, avgMonthlyProfit, simPct, simHorizon),
    [planning.bankBalance, planning.circulationBalance, avgMonthlyProfit, simPct, simHorizon],
  );

  const handleSaveCushion = () => {
    const value = Math.max(0, Number(cushionInput) || 0);
    setPlanning((prev) => {
      const next = { ...prev, cushionGoalAmount: value };
      saveCapitalPlanningState(next);
      return next;
    });
  };

  const handleUseManualPct = (value: number) => {
    setPlanning((prev) => {
      const next = { ...prev, bankSplitPctManualOverride: true, bankSplitPct: value };
      saveCapitalPlanningState(next);
      return next;
    });
  };

  const handleResetToAuto = () => {
    setPlanning((prev) => {
      const next = { ...prev, bankSplitPctManualOverride: false };
      saveCapitalPlanningState(next);
      return next;
    });
  };

  const handleExportCsv = () => {
    downloadCsv('reinvest-trade-history.csv', buildTradeHistoryCsv(items, taxMode));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[11px] font-semibold text-slate-500">
        <ShieldAlert size={14} className="shrink-0 mt-0.5 text-slate-400" />
        These calculations are executive tools based on your actual data — not formal tax or financial advisory.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 space-y-2.5">
          <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
            <PiggyBank size={14} /> Safety Cushion Reserve
          </h2>
          {planning.cushionGoalAmount > 0 ? (
            <>
              <div className="flex items-baseline justify-between">
                <span className="text-lg font-black text-slate-900">{formatEURPrefix(planning.bankBalance)}</span>
                <span className="text-xs text-slate-400 font-semibold">
                  of {formatEURPrefix(planning.cushionGoalAmount)}
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all"
                  style={{ width: `${cushionFilledPct}%` }}
                />
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-500 font-semibold">
              Suggested target: {formatEURPrefix(suggestedCushion)} (~3 months of operating expenses).
            </p>
          )}
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              step={50}
              value={cushionInput}
              onChange={(e) => setCushionInput(e.target.value)}
              className="w-28 px-2 py-1.5 rounded-lg border border-slate-200 font-bold text-xs"
            />
            <button
              type="button"
              onClick={handleSaveCushion}
              className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-[10px] font-black uppercase tracking-wider"
            >
              Set goal
            </button>
          </div>
          <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
            <span className="font-bold text-slate-600">
              Split to reserve: <span className="text-slate-900">{effectivePct}%</span>{' '}
              {planning.bankSplitPctManualOverride ? '(manual)' : '(auto)'}
            </span>
            {planning.bankSplitPctManualOverride && (
              <button type="button" onClick={handleResetToAuto} className="text-[10px] font-black uppercase text-blue-600">
                Reset to auto
              </button>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 space-y-2.5">
          <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-400">Capital Distribution</h2>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase">Reserve Bank</p>
              <p className="text-lg font-black text-slate-900">{formatEURPrefix(planning.bankBalance)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase">In Circulation</p>
              <p className="text-lg font-black text-slate-900">{formatEURPrefix(planning.circulationBalance)}</p>
            </div>
          </div>
        </section>
      </div>

      {concentration.hasWarning && (
        <p className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" /> High capital concentration: {concentration.topVariantName} represents {concentration.topVariantPct}% of active inventory capital.
        </p>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 space-y-3">
        <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
          <TrendingUp size={14} /> Growth Projection
        </h2>
        {avgMonthlyProfit <= 0 ? (
          <p className="text-xs text-slate-400 font-semibold">
            Not enough monthly sales history yet for a projection.
          </p>
        ) : (
          <p className="text-[11px] text-slate-400 font-semibold">
            Trajectory based on your average monthly net profit ({formatEURPrefix(Math.round(avgMonthlyProfit))}/mo).
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
            Split %
            <input
              type="range"
              min={10}
              max={80}
              step={5}
              value={simPct}
              onChange={(e) => setSimPct(Number(e.target.value))}
              className="w-32 accent-blue-600"
            />
            <span className="text-slate-900">{simPct}%</span>
          </label>
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
            {[6, 12, 24].map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setSimHorizon(h as 6 | 12 | 24)}
                className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase ${
                  simHorizon === h ? 'bg-slate-900 text-white' : 'text-slate-500'
                }`}
              >
                {h}mo
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => handleUseManualPct(simPct)}
            className="px-3 py-1.5 rounded-lg border border-slate-200 text-[10px] font-black uppercase tracking-wider text-slate-600 hover:bg-slate-50"
          >
            Use this % going forward
          </button>
        </div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={projection}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} label={{ value: 'Months', position: 'insideBottom', offset: -2, fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} width={48} />
              <Tooltip formatter={(v: number) => formatEURPrefix(v)} labelFormatter={(m) => `Month ${m}`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="bank" name="Bank Reserve" stroke="#0a84ff" strokeWidth={2} dot={false} />
              <Line
                type="monotone"
                dataKey="circulation"
                name="Circulation"
                stroke="#10b981"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 space-y-2">
        <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
          <Clock size={14} /> Break-Even Holding Timers
        </h2>
        {!breakEvenTimers.length ? (
          <p className="text-xs text-slate-400 font-semibold">
            No active positions with a velocity average.
          </p>
        ) : (
          <div className="space-y-1.5">
            {breakEvenTimers.slice(0, 20).map((t) => (
              <div key={t.itemId} className="space-y-0.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-bold text-slate-700 truncate pr-2">{t.name}</span>
                  <span className="text-slate-400 font-semibold shrink-0">
                    {t.daysInStock}d / ~{t.expectedDays}d
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${STATUS_STYLE[t.status]}`}
                    style={{ width: `${Math.min(100, (t.daysInStock / Math.max(1, t.expectedDays)) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <button
        type="button"
        onClick={handleExportCsv}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-[11px] font-black uppercase tracking-wider text-slate-700 hover:bg-slate-50"
      >
        <Download size={13} /> Export Trade History (CSV)
      </button>
    </div>
  );
};

export default ReinvestAdvisorTab;
