import React, { useEffect, useMemo, useState } from 'react';
import { Settings2, Clock, ChevronRight } from 'lucide-react';
import type { Expense, InventoryItem, TaxMode } from '../types';
import { buildReinvestData, type ReinvestGroup, type AnchorBundleGroup } from '../utils/reinvestAnalysis';
import { loadBuyHelperFees, type BuyHelperFees } from '../utils/buyHelper';
import { saveFlipFees, totalEbayFeePct, type FlipFeeSettings } from '../utils/flipCoach';
import { loadReinvestMarginOverrides } from '../utils/reinvestSettings';
import { canUseReinvestAI, generateReinvestHypotheses, hypothesisToGroup } from '../services/reinvestAI';
import { markQuestDone, type GamificationState } from '../utils/gamification';
import { formatEURPrefix } from '../utils/formatMoney';
import { computeCategoryBudgetsDetailed } from '../utils/categoryBudgets';
import { detectReinvestSuspicions, applySuspicionAnswersToGroups } from '../utils/reinvestSuspicion';
import { loadReinvestUserAnswers, saveReinvestUserAnswer } from '../utils/reinvestUserAnswers';
import { buildReinvestTodayBrief } from '../utils/reinvestTodayBrief';
import ReinvestCard from './reinvest/ReinvestCard';
import ReinvestCheatSheet from './reinvest/ReinvestCheatSheet';
import ReinvestBestSellers from './reinvest/ReinvestBestSellers';
import ReinvestStockedStrip from './reinvest/ReinvestStockedStrip';
import ReinvestSkipList from './reinvest/ReinvestSkipList';
import ReinvestGameTab from './reinvest/ReinvestGameTab';
import ReinvestAdvisorTab from './reinvest/ReinvestAdvisorTab';
import ReinvestCategoryBudgets from './reinvest/ReinvestCategoryBudgets';
import ReinvestStockGaps from './reinvest/ReinvestStockGaps';
import ReinvestTodayBriefPanel from './reinvest/ReinvestTodayBrief';
import ReinvestScenarios from './reinvest/ReinvestScenarios';
import './reinvest/reinvest.css';

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
  const [marginOverrides] = useState<Record<string, number>>(() => loadReinvestMarginOverrides());
  const [answers, setAnswers] = useState(() => loadReinvestUserAnswers());
  const [intentFilter, setIntentFilter] = useState<'all' | 'standalone' | 'kit'>('all');
  const [focusGroupKey, setFocusGroupKey] = useState<string | null>(null);

  const data = useMemo(() => buildReinvestData(items), [items]);
  const budgetsDetailed = useMemo(() => computeCategoryBudgetsDetailed(items), [items]);

  const adjustedVariants = useMemo(
    () => applySuspicionAnswersToGroups(data.variants, answers) as ReinvestGroup[],
    [data.variants, answers],
  );
  const adjustedBundles = useMemo(
    () => applySuspicionAnswersToGroups(data.bundles, answers) as AnchorBundleGroup[],
    [data.bundles, answers],
  );

  const restock = useMemo(() => {
    const list: Array<ReinvestGroup | AnchorBundleGroup> = [
      ...adjustedVariants.filter((g) => g.kind === 'variant' && g.verdict === 'restock'),
      ...adjustedBundles.filter((g) => g.verdict === 'restock'),
    ];
    return list.sort((a, b) => b.profitPerDay - a.profitPerDay);
  }, [adjustedVariants, adjustedBundles]);

  const stocked = useMemo(
    () => [
      ...adjustedVariants.filter((g) => g.kind === 'variant' && g.verdict === 'stocked'),
      ...adjustedBundles.filter((g) => g.verdict === 'stocked'),
    ],
    [adjustedVariants, adjustedBundles],
  );

  const skipped = useMemo(
    () => [
      ...adjustedVariants.filter((g) => g.kind === 'variant' && g.verdict === 'skip'),
      ...adjustedBundles.filter((g) => g.verdict === 'skip'),
    ],
    [adjustedVariants, adjustedBundles],
  );

  const thinRestock = useMemo(() => adjustedVariants.filter((g) => g.kind === 'hypothesis'), [adjustedVariants]);
  const hypotheses = useMemo(() => [...thinRestock, ...aiHypotheses], [thinRestock, aiHypotheses]);
  const bundleFocus = useMemo(
    () => [...adjustedBundles].sort((a, b) => b.soldCount - a.soldCount || b.profitPerDay - a.profitPerDay).slice(0, 8),
    [adjustedBundles],
  );

  const suspicions = useMemo(
    () =>
      detectReinvestSuspicions({
        items,
        data: { ...data, variants: adjustedVariants, bundles: adjustedBundles },
        budgets: budgetsDetailed,
        answers,
      }),
    [items, data, adjustedVariants, adjustedBundles, budgetsDetailed, answers],
  );

  const todayBrief = useMemo(
    () =>
      buildReinvestTodayBrief({
        restock,
        skipped,
        suspicions,
        items,
        fees,
        gamification,
        intentFilter,
      }),
    [restock, skipped, suspicions, items, fees, gamification, intentFilter],
  );

  const opportunity = useMemo(
    () => restock.reduce((sum, g) => sum + Math.max(0, g.targetStock - g.currentStock) * Math.max(0, g.allInclAvgProfit), 0),
    [restock],
  );

  const displayRestock = useMemo(() => {
    if (intentFilter === 'kit') return restock.filter((g) => g.kind === 'bundle');
    if (intentFilter === 'standalone') return restock.filter((g) => g.kind !== 'bundle');
    return restock;
  }, [restock, intentFilter]);

  useEffect(() => {
    if (!focusGroupKey) return;
    const el = document.querySelector(`[data-reinvest-group="${CSS.escape(focusGroupKey)}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFocusGroupKey(null);
  }, [focusGroupKey, buyListMode, view]);

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

  const nothingToShow = !displayRestock.length && !hypotheses.length && !loadingHypotheses;

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
    <div className="reinvest-shell space-y-5 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-[var(--rx-ink)]">Reinvest</h1>
        </div>
        <div className="rx-seg">
          <button type="button" aria-pressed={view === 'buylist'} onClick={() => setView('buylist')}>
            Buy
          </button>
          <button type="button" aria-pressed={view === 'progress'} onClick={() => setView('progress')}>
            Progress
          </button>
          <button type="button" aria-pressed={view === 'planning'} onClick={() => setView('planning')}>
            Plan
          </button>
        </div>
      </header>

      {view === 'buylist' && (
        <div className="rx-panel grid grid-cols-3 divide-x divide-[var(--rx-line)] overflow-hidden">
          <div className="p-3.5">
            <p className="text-[11px] font-medium text-[var(--rx-muted)]">Opportunity</p>
            <p className="rx-num text-[20px] font-semibold tracking-tight mt-1">{formatEURPrefix(opportunity)}</p>
          </div>
          <div className="p-3.5">
            <p className="text-[11px] font-medium text-[var(--rx-muted)]">Restock</p>
            <p className="rx-num text-[20px] font-semibold tracking-tight mt-1">{restock.length}</p>
          </div>
          <div className="p-3.5">
            <p className="text-[11px] font-medium text-[var(--rx-muted)]">Review</p>
            <p className="rx-num text-[20px] font-semibold tracking-tight mt-1">
              {skipped.length + data.agingListings.length}
            </p>
          </div>
        </div>
      )}

      {view === 'buylist' && (
        <ReinvestTodayBriefPanel
          brief={todayBrief}
          intentFilter={intentFilter}
          onIntentFilterChange={setIntentFilter}
          onFocusGroup={(key) => {
            setBuyListMode('cards');
            setFocusGroupKey(key);
          }}
          onAnswer={(suspicion, optionId) => {
            setAnswers(saveReinvestUserAnswer(suspicion.id, optionId));
          }}
        />
      )}

      {view === 'buylist' && (
        <ReinvestScenarios
          items={items}
          data={data}
          budgets={budgetsDetailed}
          restock={restock}
          skipped={skipped}
          fees={fees}
          gamification={gamification}
        />
      )}

      {view === 'buylist' && (
        <ReinvestCategoryBudgets
          items={items}
          onResplitHint={() =>
            setAnswers(saveReinvestUserAnswer('unattributed_pcs', 'recalc_pcs'))
          }
        />
      )}
      {view === 'buylist' && <ReinvestStockGaps items={items} restockHints={displayRestock} />}

      {view === 'buylist' && (
        <div className="flex items-center justify-between gap-3">
          <div className="rx-seg">
            <button type="button" aria-pressed={buyListMode === 'cards'} onClick={() => setBuyListMode('cards')}>
              Cards
            </button>
            <button type="button" aria-pressed={buyListMode === 'table'} onClick={() => setBuyListMode('table')}>
              Table
            </button>
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => setSettingsOpen((v) => !v)}
              aria-label="Fee settings"
              className="p-2 rounded-full border border-[var(--rx-line)] bg-white text-[var(--rx-muted)] hover:text-[var(--rx-ink)]"
            >
              <Settings2 size={14} />
            </button>
            {settingsOpen && (
              <div className="absolute right-0 top-full mt-2 z-10 w-56 rounded-xl border border-[var(--rx-line)] bg-white shadow-[var(--rx-shadow)] p-3 space-y-2">
                <label className="flex items-center justify-between gap-2 text-[12px] font-medium text-[var(--rx-muted)]">
                  eBay fee %
                  <input
                    type="number"
                    min={0}
                    max={40}
                    step={0.5}
                    value={fees.ebayFeePct}
                    onChange={(e) => updateFees({ ebayFeePct: Number(e.target.value) })}
                    className="w-14 px-2 py-1 rounded-lg border border-[var(--rx-line)] font-semibold text-[12px] rx-num"
                  />
                </label>
                <label className="flex items-center justify-between gap-2 text-[12px] font-medium text-[var(--rx-muted)]">
                  Ads %
                  <input
                    type="number"
                    min={0}
                    max={40}
                    step={0.5}
                    value={fees.ebayAdsPct}
                    onChange={(e) => updateFees({ ebayAdsPct: Number(e.target.value) })}
                    className="w-14 px-2 py-1 rounded-lg border border-[var(--rx-line)] font-semibold text-[12px] rx-num"
                  />
                </label>
                <p className="text-[11px] font-semibold text-[var(--rx-ink)]">Cut {totalEbayFeePct(fees)}%</p>
                <button
                  type="button"
                  onClick={() => updateFees({ ebayFeePct: 12.5, ebayAdsPct: 12.5 })}
                  className="w-full py-1.5 rounded-lg bg-[var(--rx-soft)] text-[11px] font-semibold text-[var(--rx-muted)]"
                >
                  Reset 25%
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {view === 'buylist' && data.agingListings.length > 0 && (
        <button
          type="button"
          onClick={() => setView('planning')}
          className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-[var(--rx-warn-soft)] text-left"
        >
          <span className="text-[13px] font-medium text-[var(--rx-warn)] flex items-center gap-2">
            <Clock size={14} /> {data.agingListings.length} aging
          </span>
          <span className="text-[12px] font-semibold text-[var(--rx-warn)] flex items-center gap-0.5">
            Plan <ChevronRight size={13} />
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
          <ReinvestBestSellers
            groups={[...data.variants, ...data.bundles]}
            fees={fees}
            limit={5}
          />

          {nothingToShow && (
            <p className="text-[13px] text-[var(--rx-muted)] font-medium p-8 text-center">
              {data.variants.length ? 'Stocked. Nothing urgent.' : 'Sell a few items to unlock buys.'}
            </p>
          )}

          {displayRestock.length > 0 && (
            <div>
              <h2 className="text-[13px] font-semibold tracking-tight mb-2.5">Restock</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {displayRestock.map((g) => (
                  <div key={g.key} data-reinvest-group={g.key}>
                    <ReinvestCard
                      group={g}
                      fees={fees}
                      initialMarginPct={marginOverrides[g.key]}
                      onPurchaseConfirmed={handlePurchaseConfirmed}
                      onOpenHypothesisSearch={handleHypothesisSearchOpened}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {bundleFocus.length > 0 && (
            <div>
              <h2 className="text-[13px] font-semibold tracking-tight mb-2.5">Kits</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {bundleFocus.map((g) => (
                  <ReinvestCard
                    key={`bundle-focus-${g.key}`}
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
              <h2 className="text-[13px] font-semibold tracking-tight mb-2.5">Ideas</h2>
              {loadingHypotheses && !hypotheses.length ? (
                <p className="text-[12px] text-[var(--rx-muted)] font-medium">…</p>
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
