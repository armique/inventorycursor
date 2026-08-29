import React, { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { Settings2, Clock, ChevronRight } from 'lucide-react';
import type { Expense, InventoryItem, TaxMode } from '../types';
import { buildReinvestData, type ReinvestGroup, type AnchorBundleGroup } from '../utils/reinvestAnalysis';
import { loadReinvestFees, type ReinvestFees } from '../utils/reinvestFees';
import { saveFlipFees, totalEbayFeePct, type FlipFeeSettings } from '../utils/flipCoach';
import { loadReinvestMarginOverrides } from '../utils/reinvestSettings';
import { canUseReinvestAI, generateReinvestHypotheses, hypothesisToGroup } from '../services/reinvestAI';
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
import ReinvestCategoryBudgets from './reinvest/ReinvestCategoryBudgets';
import ReinvestStockGaps from './reinvest/ReinvestStockGaps';
import ReinvestTodayBriefPanel from './reinvest/ReinvestTodayBrief';
import CapitalReserveCard from './CapitalReserveCard';
import MaxBuyPanel from './MaxBuyPanel';
import { computeRepeatWinners } from '../utils/repeatWinners';
import './reinvest/reinvest.css';

type Props = {
  items: InventoryItem[];
  expenses: Expense[];
  taxMode: TaxMode;
};

type View = 'buylist' | 'planning';

const ReinvestAdvisorTab = lazy(() => import('./reinvest/ReinvestAdvisorTab'));

const ReinvestAssistantPage: React.FC<Props> = ({ items, expenses, taxMode }) => {
  const [view, setView] = useState<View>('buylist');
  const [buyListMode, setBuyListMode] = useState<'cards' | 'table'>('cards');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fees, setFees] = useState<ReinvestFees>(() => loadReinvestFees());
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
        variants: data.variants,
        bundles: data.bundles,
        agingCount: data.agingListings.length,
      }),
    [items, data.variants, data.bundles, data.agingListings.length],
  );

  const todayBrief = useMemo(
    () =>
      buildReinvestTodayBrief({
        variants: adjustedVariants,
        bundles: adjustedBundles,
        aging: data.agingListings,
        suspicions,
        answers,
        items,
      }),
    [adjustedVariants, adjustedBundles, data.agingListings, suspicions, answers, items],
  );

  const winners = useMemo(() => computeRepeatWinners(items), [items]);

  useEffect(() => {
    if (!focusGroupKey) return;
    const el = document.querySelector(`[data-reinvest-group="${focusGroupKey}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-brand-500', 'ring-offset-2');
      const t = setTimeout(() => el.classList.remove('ring-2', 'ring-brand-500', 'ring-offset-2'), 2500);
      return () => clearTimeout(t);
    }
  }, [focusGroupKey]);

  useEffect(() => {
    if (!canUseReinvestAI()) return;
    let cancel = false;
    setLoadingHypotheses(true);
    generateReinvestHypotheses(data.variants)
      .then((hyps) => {
        if (cancel) return;
        setAiHypotheses(hyps.map(hypothesisToGroup));
      })
      .catch((err) => {
        if (cancel) return;
        console.warn('AI Reinvest hypotheses failed:', err);
      })
      .finally(() => {
        if (!cancel) setLoadingHypotheses(false);
      });
    return () => {
      cancel = true;
    };
  }, [data.variants]);

  const updateFees = (partial: Partial<ReinvestFees>) => {
    setFees((prev) => {
      const next = { ...prev, ...partial };
      const flipSettings: FlipFeeSettings = {
        ebayFeePct: next.ebayFeePct,
        adsPct: next.ebayAdsPct,
        manualOverride: true,
      };
      saveFlipFees(flipSettings);
      return next;
    });
  };

  const opportunity = useMemo(() => {
    const sumRestock = restock.reduce((acc, g) => acc + g.avgProfit, 0);
    return sumRestock;
  }, [restock]);

  const displayRestock = useMemo(() => {
    if (intentFilter === 'standalone') return restock.filter((g) => g.kind === 'variant');
    if (intentFilter === 'kit') return restock.filter((g) => g.kind === 'bundle');
    return restock;
  }, [restock, intentFilter]);

  const nothingToShow =
    displayRestock.length === 0 &&
    bundleFocus.length === 0 &&
    stocked.length === 0 &&
    skipped.length === 0 &&
    hypotheses.length === 0;

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
          <button type="button" aria-pressed={view === 'planning'} onClick={() => setView('planning')}>
            Plan
          </button>
        </div>
      </header>

      {view === 'buylist' && (
        <div className="space-y-3">
          <CapitalReserveCard cashOnHand={0} />
          <MaxBuyPanel items={items} compact />
          {winners.length > 0 && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-800 mb-1.5">
                Repeat winners · &gt;30% in &lt;14d
              </p>
              <p className="text-[12px] font-semibold text-emerald-950">
                {winners.map((w) => `${w.label} (${w.soldCount}× · ${w.avgDays}d)`).join(' · ')}
              </p>
            </div>
          )}
        </div>
      )}

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

      {view === 'planning' ? (
        <Suspense fallback={<div className="h-64 rounded-xl bg-[var(--rx-soft)] animate-pulse" />}>
          <ReinvestAdvisorTab
            items={items}
            expenses={expenses}
            taxMode={taxMode}
            reinvestData={data}
          />
        </Suspense>
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
                      onPurchaseConfirmed={() => {}}
                      onOpenHypothesisSearch={() => {}}
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
                    onPurchaseConfirmed={() => {}}
                    onOpenHypothesisSearch={() => {}}
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
                      onPurchaseConfirmed={() => {}}
                      onOpenHypothesisSearch={() => {}}
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
