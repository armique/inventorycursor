import React, { useEffect, useMemo, useState } from 'react';
import {
  Coins,
  Settings2,
  Gamepad2,
  Landmark,
  LayoutGrid,
  List,
  Clock,
  ChevronRight,
  Target,
  ShoppingCart,
  Eye,
} from 'lucide-react';
import type { Expense, InventoryItem, TaxMode } from '../types';
import { buildReinvestData, type ReinvestGroup, type AnchorBundleGroup } from '../utils/reinvestAnalysis';
import { loadBuyHelperFees, type BuyHelperFees } from '../utils/buyHelper';
import { saveFlipFees, type FlipFeeSettings } from '../utils/flipCoach';
import { loadReinvestMarginOverrides } from '../utils/reinvestSettings';
import { canUseReinvestAI, generateReinvestHypotheses, hypothesisToGroup } from '../services/reinvestAI';
import { markQuestDone, type GamificationState } from '../utils/gamification';
import { formatEURPrefix } from '../utils/formatMoney';
import ReinvestCard from './reinvest/ReinvestCard';
import ReinvestCheatSheet from './reinvest/ReinvestCheatSheet';
import ReinvestStockedStrip from './reinvest/ReinvestStockedStrip';
import ReinvestSkipList from './reinvest/ReinvestSkipList';
import ReinvestGameTab from './reinvest/ReinvestGameTab';
import ReinvestAdvisorTab from './reinvest/ReinvestAdvisorTab';
import ReinvestCategoryBudgets from './reinvest/ReinvestCategoryBudgets';

type Props = {
  items: InventoryItem[];
  expenses: Expense[];
  taxMode: TaxMode;
  gamification: GamificationState;
  updateGamification: (updater: (prev: GamificationState) => GamificationState) => void;
};

type View = 'buylist' | 'progress' | 'planning';

const ReinvestAssistantPage: React.FC<Props> = ({ items, expenses, taxMode, gamification, updateGamification }) => {
  const [view, setView] = useState<View>('buylist');
  const [buyListMode, setBuyListMode] = useState<'cards' | 'table'>('cards');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fees, setFees] = useState<BuyHelperFees>(() => loadBuyHelperFees());
  const [aiHypotheses, setAiHypotheses] = useState<ReinvestGroup[]>([]);
  const [loadingHypotheses, setLoadingHypotheses] = useState(false);
  // Read once — ReinvestCard persists further slider changes itself; the page doesn't need to
  // re-render the whole grid on every tick of any one card's margin slider.
  const [marginOverrides] = useState<Record<string, number>>(() => loadReinvestMarginOverrides());

  const data = useMemo(() => buildReinvestData(items), [items]);

  const restock = useMemo(() => {
    const list: Array<ReinvestGroup | AnchorBundleGroup> = [
      ...data.variants.filter((g) => g.kind === 'variant' && g.verdict === 'restock'),
      ...data.bundles.filter((g) => g.verdict === 'restock'),
    ];
    return list.sort((a, b) => b.profitPerDay - a.profitPerDay);
  }, [data.variants, data.bundles]);

  const stocked = useMemo(
    () => [
      ...data.variants.filter((g) => g.kind === 'variant' && g.verdict === 'stocked'),
      ...data.bundles.filter((g) => g.verdict === 'stocked'),
    ],
    [data.variants, data.bundles],
  );

  const skipped = useMemo(
    () => [
      ...data.variants.filter((g) => g.kind === 'variant' && g.verdict === 'skip'),
      ...data.bundles.filter((g) => g.verdict === 'skip'),
    ],
    [data.variants, data.bundles],
  );

  const thinRestock = useMemo(() => data.variants.filter((g) => g.kind === 'hypothesis'), [data.variants]);
  const hypotheses = useMemo(() => [...thinRestock, ...aiHypotheses], [thinRestock, aiHypotheses]);

  const opportunity = useMemo(
    () => restock.reduce((sum, g) => sum + Math.max(0, g.targetStock - g.currentStock) * Math.max(0, g.allInclAvgProfit), 0),
    [restock],
  );

  useEffect(() => {
    if (!canUseReinvestAI()) return;
    let cancelled = false;
    setLoadingHypotheses(true);
    const knownCategories = Array.from(
      new Set(items.map((i) => i.subCategory || i.category).filter(Boolean)),
    ) as string[];
    const avgBuy = data.variants.length
      ? data.variants.reduce((sum, g) => sum + g.avgBuyPrice, 0) / data.variants.length
      : 0;
    generateReinvestHypotheses(knownCategories, avgBuy, 3, data.adjacentCategories)
      .then((list) => {
        if (!cancelled) setAiHypotheses(list.map(hypothesisToGroup));
      })
      .finally(() => {
        if (!cancelled) setLoadingHypotheses(false);
      });
    return () => {
      cancelled = true;
    };
    // Mount-only: regenerating AI ideas on every inventory edit would spam the AI provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateFees = (patch: Partial<FlipFeeSettings>) => {
    const next: FlipFeeSettings = {
      ebayFeePct: patch.ebayFeePct ?? fees.ebayFeePct,
      ebayAdsPct: patch.ebayAdsPct ?? fees.ebayAdsPct,
    };
    saveFlipFees(next);
    setFees(loadBuyHelperFees());
  };

  const nothingToShow = !restock.length && !hypotheses.length && !loadingHypotheses;

  const handlePurchaseConfirmed = (buyPrice: number) => {
    updateGamification((prev) => ({
      ...prev,
      reinvestRookie: true,
      dailyBudget: { ...prev.dailyBudget, spentVirtual: prev.dailyBudget.spentVirtual + Math.max(0, buyPrice) },
    }));
  };

  const handleHypothesisSearchOpened = (groupKey: string) => {
    updateGamification((prev) => markQuestDone(prev, `try-hypothesis-${groupKey}`));
  };

  return (
    <div className="space-y-4 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <Coins size={20} className="text-brand-500" /> Reinvest
          </h1>
          <p className="text-xs text-slate-400 font-semibold flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live — priced from your own sales
          </p>
        </div>
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
          <button
            type="button"
            onClick={() => setView('buylist')}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider ${
              view === 'buylist' ? 'bg-slate-900 text-white' : 'text-slate-500'
            }`}
          >
            Buy list
          </button>
          <button
            type="button"
            onClick={() => setView('progress')}
            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider ${
              view === 'progress' ? 'bg-slate-900 text-white' : 'text-slate-500'
            }`}
          >
            <Gamepad2 size={12} /> Progress
          </button>
          <button
            type="button"
            onClick={() => setView('planning')}
            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider ${
              view === 'planning' ? 'bg-slate-900 text-white' : 'text-slate-500'
            }`}
          >
            <Landmark size={12} /> Planning
          </button>
        </div>
      </header>

      {view === 'buylist' && (
        <div className="grid grid-cols-3 gap-2.5">
          <div className="rounded-xl bg-white border border-slate-200 shadow-card p-3">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
              <Target size={12} /> Opportunity
            </p>
            <p className="text-lg font-black text-slate-900">{formatEURPrefix(opportunity)}</p>
          </div>
          <div className="rounded-xl bg-white border border-slate-200 shadow-card p-3">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
              <ShoppingCart size={12} /> To restock
            </p>
            <p className="text-lg font-black text-slate-900">{restock.length}</p>
          </div>
          <div className="rounded-xl bg-white border border-slate-200 shadow-card p-3">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
              <Eye size={12} /> To review
            </p>
            <p className="text-lg font-black text-slate-900">{skipped.length + data.agingListings.length}</p>
          </div>
        </div>
      )}

      {view === 'buylist' && <ReinvestCategoryBudgets items={items} />}

      {view === 'buylist' && (
        <div className="flex items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            <button
              type="button"
              onClick={() => setBuyListMode('cards')}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[10px] font-black uppercase tracking-wider ${
                buyListMode === 'cards' ? 'bg-slate-900 text-white' : 'text-slate-500'
              }`}
            >
              <LayoutGrid size={12} /> Cards
            </button>
            <button
              type="button"
              onClick={() => setBuyListMode('table')}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[10px] font-black uppercase tracking-wider ${
                buyListMode === 'table' ? 'bg-slate-900 text-white' : 'text-slate-500'
              }`}
            >
              <List size={12} /> Table
            </button>
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => setSettingsOpen((v) => !v)}
              aria-label="Fee settings"
              className="p-2 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
            >
              <Settings2 size={14} />
            </button>
            {settingsOpen && (
              <div className="absolute right-0 top-full mt-2 z-10 w-64 rounded-xl border border-slate-200 bg-white shadow-card-hover p-3 space-y-2">
                <label className="flex items-center justify-between gap-2 text-xs font-bold text-slate-600">
                  eBay fee %
                  <input
                    type="number"
                    min={0}
                    max={40}
                    step={0.5}
                    value={fees.ebayFeePct}
                    onChange={(e) => updateFees({ ebayFeePct: Number(e.target.value) })}
                    className="w-16 px-2 py-1 rounded-lg border border-slate-200 font-bold text-xs"
                  />
                </label>
                <label className="flex items-center justify-between gap-2 text-xs font-bold text-slate-600">
                  Ads %
                  <input
                    type="number"
                    min={0}
                    max={40}
                    step={0.5}
                    value={fees.ebayAdsPct}
                    onChange={(e) => updateFees({ ebayAdsPct: Number(e.target.value) })}
                    className="w-16 px-2 py-1 rounded-lg border border-slate-200 font-bold text-xs"
                  />
                </label>
                <p className="text-[10px] text-slate-400 font-semibold">Shared with Flip Coach / Buy Helper.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {view === 'buylist' && data.agingListings.length > 0 && (
        <button
          type="button"
          onClick={() => setView('planning')}
          className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-amber-50 hover:bg-amber-100 transition-colors text-left"
        >
          <span className="text-xs font-bold text-amber-800 flex items-center gap-2">
            <Clock size={14} /> {data.agingListings.length} listing{data.agingListings.length === 1 ? '' : 's'} sitting
            longer than usual
          </span>
          <span className="text-[11px] font-black text-amber-700 flex items-center gap-0.5">
            Review in Planning <ChevronRight size={13} />
          </span>
        </button>
      )}

      {view === 'progress' ? (
        <ReinvestGameTab
          items={items}
          reinvestData={data}
          gamification={gamification}
          updateGamification={updateGamification}
        />
      ) : view === 'planning' ? (
        <ReinvestAdvisorTab
          items={items}
          expenses={expenses}
          taxMode={taxMode}
          reinvestData={data}
          gamification={gamification}
          updateGamification={updateGamification}
        />
      ) : buyListMode === 'table' ? (
        <ReinvestCheatSheet variants={data.variants} bundles={data.bundles} fees={fees} />
      ) : (
        <>
          {!data.seasonalityReady && data.historyDays > 0 && (
            <p className="text-[11px] text-slate-400 font-semibold">
              Seasonal timing needs ~6 months of sold history (you have ~{Math.round(data.historyDays / 30)} mo) —
              it'll kick in automatically once there's enough.
            </p>
          )}

          {nothingToShow && (
            <p className="text-sm text-slate-400 font-semibold p-6 text-center">
              {data.variants.length
                ? 'Everything you sell well is already stocked at target level.'
                : 'Sell a few items to start seeing recommendations here.'}
            </p>
          )}

          {restock.length > 0 && (
            <div>
              <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2">
                Buy now · fastest and most profitable first
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {restock.map((g) => (
                  <ReinvestCard
                    key={g.key}
                    group={g}
                    fees={fees}
                    initialMarginPct={marginOverrides[g.key]}
                    onPurchaseConfirmed={handlePurchaseConfirmed}
                    onOpenHypothesisSearch={handleHypothesisSearchOpened}
                  />
                ))}
              </div>
            </div>
          )}

          <ReinvestStockedStrip groups={stocked} />
          <ReinvestSkipList groups={skipped} />

          {(hypotheses.length > 0 || loadingHypotheses) && (
            <div>
              <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2">
                Hypotheses — thin or no track record
              </h2>
              {loadingHypotheses && !hypotheses.length ? (
                <p className="text-xs text-slate-400 font-semibold">Thinking of ideas…</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {hypotheses.map((g) => (
                    <ReinvestCard
                      key={g.key}
                      group={g}
                      fees={fees}
                      initialMarginPct={marginOverrides[g.key]}
                      onPurchaseConfirmed={handlePurchaseConfirmed}
                      onOpenHypothesisSearch={handleHypothesisSearchOpened}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ReinvestAssistantPage;
