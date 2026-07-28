/**
 * Detects the game-event triggers from section 3.1/3.2 by watching the same `items` state every
 * sale flow already funnels through (SaleModal/TradeModal/GiftModal/bulk edit/eBay sync) — no
 * hooks added to those components. A single-item queue keeps at most one toast visible at a time.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Expense, InventoryItem, TaxMode } from '../types';
import { isRealizedDisposal } from '../utils/itemDisposition';
import { computeItemProfitBeforeOverhead, roundMoney } from '../services/financialAggregation';
import { buildReinvestData } from '../utils/reinvestAnalysis';
import { computeReinvestPricing, defaultMarginForGroup } from '../utils/reinvestPricing';
import { loadBuyHelperFees } from '../utils/buyHelper';
import { localWeekKey } from '../utils/flipCoachMissions';
import {
  addToBank,
  applyCirculationCredit,
  applyPurchaseDebit,
  computeMonthNetProfit,
  effectiveBankSplitPct,
  suggestTakeAmount,
  takeToPocket,
  type GamificationState,
} from '../utils/gamification';

export type GamificationEvent =
  | {
      kind: 'deal-closed';
      id: string;
      itemName: string;
      profit: number;
      suggestedTake: number;
      /** Already applied automatically by the time the toast shows — shown for transparency. */
      circulationCredit: number;
    }
  | {
      kind: 'expansion-signal';
      id: string;
      groupKey: string;
      label: string;
      buyMax: number;
      sellHint: number;
      sampleSize: number;
      avgDaysToSell: number;
    }
  | { kind: 'digest-ready'; id: string };

type Options = {
  items: InventoryItem[];
  expenses: Expense[];
  taxMode: TaxMode;
  gamification: GamificationState;
  updateGamification: (updater: (prev: GamificationState) => GamificationState) => void;
};

export function useGamificationEvents({ items, expenses, taxMode, gamification, updateGamification }: Options) {
  const [queue, setQueue] = useState<GamificationEvent[]>([]);
  const prevItemsRef = useRef<InventoryItem[] | null>(null);
  const mountedOnceRef = useRef(false);
  // Read the latest gamification state inside the items-diff effect without making it a
  // dependency — the % split and cushion state shouldn't retrigger a full item-list rescan.
  const gamificationRef = useRef(gamification);
  useEffect(() => {
    gamificationRef.current = gamification;
  }, [gamification]);

  // "Deal closed" (money in) + purchase debit (money out) — fires only for changes that happened
  // AFTER mount, never retroactively on page load.
  useEffect(() => {
    const prev = prevItemsRef.current;
    prevItemsRef.current = items;
    if (!mountedOnceRef.current) {
      mountedOnceRef.current = true;
      return;
    }
    if (!prev) return;
    const prevIds = new Set(prev.map((i) => i.id));

    // --- Money in: newly realized sales ---
    const prevRealizedIds = new Set(
      prev.filter((i) => isRealizedDisposal(i) && (Number(i.sellPrice) || 0) > 0).map((i) => i.id),
    );
    const newlyRealized = items.filter(
      (i) => isRealizedDisposal(i) && (Number(i.sellPrice) || 0) > 0 && !prevRealizedIds.has(i.id),
    );
    if (newlyRealized.length) {
      const monthNetProfit = computeMonthNetProfit(items, expenses, taxMode);
      const bankSplitPct = effectiveBankSplitPct(gamificationRef.current);
      const events: GamificationEvent[] = [];
      let totalCirculationCredit = 0;
      for (const item of newlyRealized) {
        const profit = roundMoney(computeItemProfitBeforeOverhead(item, taxMode));
        if (profit <= 0) continue; // celebrate wins only
        const suggestedTake = suggestTakeAmount(profit, bankSplitPct, monthNetProfit);
        const circulationCredit = roundMoney(profit - suggestedTake);
        totalCirculationCredit += circulationCredit;
        events.push({
          kind: 'deal-closed',
          id: `deal-${item.id}-${Date.now()}`,
          itemName: item.name,
          profit,
          suggestedTake,
          circulationCredit,
        });
      }
      if (events.length) setQueue((q) => [...q, ...events]);
      // The non-bank share is credited automatically — no user choice, per section 4.
      if (totalCirculationCredit > 0) {
        const credit = roundMoney(totalCirculationCredit);
        updateGamification((p) => applyCirculationCredit(p, credit));
      }
    }

    // --- Money out: newly appeared purchases (any add-item flow, not just Reinvest) ---
    const newlyBought = items.filter(
      (i) => !prevIds.has(i.id) && !i.isDraft && !i.isBundle && !i.isPC && !i.parentContainerId && (Number(i.buyPrice) || 0) > 0,
    );
    if (newlyBought.length) {
      const totalSpent = roundMoney(newlyBought.reduce((s, i) => s + (Number(i.buyPrice) || 0), 0));
      if (totalSpent > 0) updateGamification((p) => applyPurchaseDebit(p, totalSpent));
    }
    // Only `items` should retrigger this diff — expenses/taxMode are read fresh each time it
    // does fire, and gamification is read via the ref above, not a reason to re-scan on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // "Expansion signal" — at most once per day, only when a real up-trending gap exists.
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (gamification.lastExpansionSignalAt === today) return;
    const data = buildReinvestData(items);
    const candidate = data.variants.find(
      (g) => g.kind === 'variant' && g.confidence !== 'low' && g.trend === 'up' && g.currentStock < g.targetStock,
    );
    if (!candidate) return;
    const fees = loadBuyHelperFees();
    const pricing = computeReinvestPricing(candidate, fees, defaultMarginForGroup(candidate));
    if (pricing.suggestedMaxBuy == null) return;
    setQueue((q) => [
      ...q,
      {
        kind: 'expansion-signal',
        id: `expansion-${candidate.key}-${today}`,
        groupKey: candidate.key,
        label: candidate.label,
        buyMax: pricing.suggestedMaxBuy,
        sellHint: pricing.sellKa || pricing.sellEbay,
        sampleSize: candidate.soldCount,
        avgDaysToSell: candidate.avgDaysToSell,
      },
    ]);
    updateGamification((prev) => ({ ...prev, lastExpansionSignalAt: today }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, gamification.lastExpansionSignalAt]);

  // Weekly digest ready — once per ISO week, only once there's at least some sold history.
  useEffect(() => {
    const week = localWeekKey();
    if (gamification.lastDigestShownWeek === week) return;
    if (!items.some((i) => isRealizedDisposal(i) && (Number(i.sellPrice) || 0) > 0)) return;
    setQueue((q) => [...q, { kind: 'digest-ready', id: `digest-${week}` }]);
    updateGamification((prev) => ({ ...prev, lastDigestShownWeek: week }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, gamification.lastDigestShownWeek]);

  const current = queue[0] ?? null;

  const dismiss = useCallback(() => {
    setQueue((q) => q.slice(1));
  }, []);

  const resolveDealClosed = useCallback(
    (event: Extract<GamificationEvent, { kind: 'deal-closed' }>, choice: 'take' | 'keep') => {
      updateGamification((prev) =>
        choice === 'take' ? takeToPocket(prev, event.suggestedTake) : addToBank(prev, event.suggestedTake),
      );
      dismiss();
    },
    [updateGamification, dismiss],
  );

  return { current, dismiss, resolveDealClosed };
}
