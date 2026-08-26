/**
 * Detects money-in/out game events from the shared `items` state every sale flow already
 * funnels through (SaleModal/TradeModal/GiftModal/bulk edit/eBay sync). Deal closes update
 * circulation silently — no profit toast. Digest may still surface when proactive events are on.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Expense, InventoryItem, TaxMode } from '../types';
import { isRealizedDisposal } from '../utils/itemDisposition';
import { computeItemProfitBeforeOverhead, roundMoney } from '../services/financialAggregation';
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
  | { kind: 'digest-ready'; id: string };

type Options = {
  items: InventoryItem[];
  expenses: Expense[];
  taxMode: TaxMode;
  gamification: GamificationState;
  updateGamification: (updater: (prev: GamificationState) => GamificationState) => void;
  /**
   * When false (e.g. cloud still downloading), keep the items baseline in sync but never
   * emit deal/purchase/digest toasts. Prevents a phone with empty local state from treating
   * every already-sold cloud item as a brand-new close on first sync.
   */
  eventsArmed?: boolean;
  /** Proactive recommendations are useful on desktop but intrusive on phones. */
  allowProactiveEvents?: boolean;
};

function isRealizedSale(item: InventoryItem): boolean {
  return isRealizedDisposal(item) && (Number(item.sellPrice) || 0) > 0;
}

/** Live sale only: same id existed before and was not yet a realized sale. */
export function findNewlyClosedDeals(prev: InventoryItem[], next: InventoryItem[]): InventoryItem[] {
  const prevById = new Map(prev.map((i) => [i.id, i]));
  return next.filter((i) => {
    if (!isRealizedSale(i)) return false;
    const was = prevById.get(i.id);
    if (!was) return false; // appeared already-sold (hydrate / merge) — not a live close
    return !isRealizedSale(was);
  });
}

export function useGamificationEvents({
  items,
  expenses,
  taxMode,
  gamification,
  updateGamification,
  eventsArmed = true,
  allowProactiveEvents = true,
}: Options) {
  const [queue, setQueue] = useState<GamificationEvent[]>([]);
  const prevItemsRef = useRef<InventoryItem[] | null>(null);
  const mountedOnceRef = useRef(false);
  const wasArmedRef = useRef(eventsArmed);
  // Read the latest gamification state inside the items-diff effect without making it a
  // dependency — the % split and cushion state shouldn't retrigger a full item-list rescan.
  const gamificationRef = useRef(gamification);
  const digestWeekQueuedRef = useRef<string | null>(null);
  useEffect(() => {
    gamificationRef.current = gamification;
    const week = gamification.lastDigestShownWeek;
    if (week) digestWeekQueuedRef.current = week;
  }, [gamification]);

  // "Deal closed" (money in) + purchase debit (money out) — fires only for changes that happened
  // AFTER mount (and after cloud hydrate when eventsArmed flips on), never retroactively.
  useEffect(() => {
    // Disarmed (cloud downloading): track baseline only, never celebrate/debit.
    if (!eventsArmed) {
      prevItemsRef.current = items;
      mountedOnceRef.current = false;
      wasArmedRef.current = false;
      return;
    }

    // Just armed after hydrate — take a fresh baseline, skip this tick.
    if (!wasArmedRef.current) {
      wasArmedRef.current = true;
      prevItemsRef.current = items;
      mountedOnceRef.current = true;
      return;
    }

    const prev = prevItemsRef.current;
    prevItemsRef.current = items;
    if (!mountedOnceRef.current) {
      mountedOnceRef.current = true;
      return;
    }
    if (!prev) return;
    const prevIds = new Set(prev.map((i) => i.id));

    // --- Money in: items that transitioned to sold in this session ---
    const newlyRealized = findNewlyClosedDeals(prev, items);
    if (newlyRealized.length) {
      const monthNetProfit = computeMonthNetProfit(items, expenses, taxMode);
      const bankSplitPct = effectiveBankSplitPct(gamificationRef.current);
      let totalCirculationCredit = 0;
      for (const item of newlyRealized) {
        const profit = roundMoney(computeItemProfitBeforeOverhead(item, taxMode));
        if (profit <= 0) continue; // credit wins only
        const suggestedTake = suggestTakeAmount(profit, bankSplitPct, monthNetProfit);
        const circulationCredit = roundMoney(profit - suggestedTake);
        totalCirculationCredit += circulationCredit;
      }
      // Apply bank/circulation silently — no deal-closed toast after Mark Sold.
      if (totalCirculationCredit > 0) {
        const credit = roundMoney(totalCirculationCredit);
        updateGamification((p) => applyCirculationCredit(p, credit));
      }
    }

    // --- Money out: newly appeared purchases (any add-item flow, not just Reinvest) ---
    // Skip bulk first-populate (empty → many ids), which is cloud hydrate / import seed.
    const newlyBought = items.filter(
      (i) => !prevIds.has(i.id) && !i.isDraft && !i.isBundle && !i.isPC && !i.parentContainerId && (Number(i.buyPrice) || 0) > 0,
    );
    const looksLikeHydrate = prev.length === 0 && newlyBought.length > 1;
    if (newlyBought.length && !looksLikeHydrate) {
      const totalSpent = roundMoney(newlyBought.reduce((s, i) => s + (Number(i.buyPrice) || 0), 0));
      if (totalSpent > 0) updateGamification((p) => applyPurchaseDebit(p, totalSpent));
    }
    // Only `items` / arming should retrigger this diff — expenses/taxMode are read fresh each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, eventsArmed]);

  // Weekly digest ready — once per ISO week, only once there's at least some sold history.
  useEffect(() => {
    if (!eventsArmed || !allowProactiveEvents) return;
    const week = localWeekKey();
    if (gamification.lastDigestShownWeek === week || digestWeekQueuedRef.current === week) return;
    if (!items.some((i) => isRealizedSale(i))) return;
    digestWeekQueuedRef.current = week;
    const digestId = `digest-${week}`;
    setQueue((q) => (q.some((e) => e.id === digestId) ? q : [...q, { kind: 'digest-ready', id: digestId }]));
    updateGamification((prev) =>
      prev.lastDigestShownWeek === week ? prev : { ...prev, lastDigestShownWeek: week },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, gamification.lastDigestShownWeek, eventsArmed, allowProactiveEvents]);

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
