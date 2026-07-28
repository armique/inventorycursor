import React, { useMemo, useState } from 'react';
import { PiggyBank, Wallet, CheckCircle2, Circle, Newspaper, ArrowLeftRight } from 'lucide-react';
import type { InventoryItem } from '../../types';
import type { ReinvestData } from '../../utils/reinvestAnalysis';
import {
  computeAchievements,
  computeWeeklyDigest,
  effectiveBankSplitPct,
  generateDailyQuests,
  markQuestDone,
  withdrawnThisMonth,
  type GamificationState,
} from '../../utils/gamification';
import { loadMissionLog } from '../../utils/flipCoachMissions';
import { formatEURPrefix } from '../../utils/formatMoney';
import AchievementGrid from '../gamification/AchievementGrid';
import WeeklyDigestCard from '../gamification/WeeklyDigestCard';

type Props = {
  items: InventoryItem[];
  reinvestData: ReinvestData;
  gamification: GamificationState;
  updateGamification: (updater: (prev: GamificationState) => GamificationState) => void;
};

const ReinvestGameTab: React.FC<Props> = ({ items, reinvestData, gamification, updateGamification }) => {
  const [showDigest, setShowDigest] = useState(false);
  const missionLog = useMemo(() => loadMissionLog(), []);
  const quests = useMemo(
    () => generateDailyQuests(reinvestData, gamification.quests, missionLog),
    [reinvestData, gamification.quests, missionLog],
  );
  const achievements = useMemo(
    () => computeAchievements(items, missionLog, { reinvestRookie: gamification.reinvestRookie }),
    [items, missionLog, gamification.reinvestRookie],
  );
  const digest = useMemo(() => computeWeeklyDigest(items, reinvestData), [items, reinvestData]);
  const unlockedCount = achievements.filter((a) => a.unlocked).length;
  const budgetPct = Math.min(
    100,
    gamification.dailyBudget.amount > 0
      ? Math.round((gamification.dailyBudget.spentVirtual / gamification.dailyBudget.amount) * 100)
      : 0,
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <section className="rounded-2xl border border-slate-200 bg-white shadow-card p-4 space-y-2.5">
          <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
            <PiggyBank size={14} /> Bank
          </h2>
          <p className="text-2xl font-black text-slate-900">{formatEURPrefix(gamification.bankBalance)}</p>
          <p className="text-[11px] text-slate-400 font-semibold flex items-center gap-1">
            <ArrowLeftRight size={11} /> In circulation: {formatEURPrefix(gamification.circulationBalance)}
          </p>
          <p className="text-[11px] text-slate-400 font-semibold">
            Withdrawn this month: {formatEURPrefix(withdrawnThisMonth(gamification))}
          </p>
          <p className="text-xs font-bold text-slate-600 pt-1">
            Split to bank: <span className="text-slate-900">{effectiveBankSplitPct(gamification)}%</span>{' '}
            <span className="text-slate-400 font-semibold">
              {gamification.bankSplitPctManualOverride ? '(manual — see Advisor)' : '(auto — see Advisor)'}
            </span>
          </p>
          {gamification.withdrawalHistory.length > 0 && (
            <div className="pt-1 border-t border-slate-100 space-y-1">
              {gamification.withdrawalHistory.slice(0, 3).map((w) => (
                <div key={w.id} className="flex items-center justify-between text-[11px] text-slate-500 font-semibold">
                  <span>{new Date(w.at).toLocaleDateString()}</span>
                  <span className="text-slate-800 font-bold">{formatEURPrefix(w.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-card p-4 space-y-2.5">
          <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
            <Wallet size={14} /> Today's buying budget
          </h2>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
            €
            <input
              type="number"
              min={0}
              step={10}
              value={gamification.dailyBudget.amount}
              onChange={(e) =>
                updateGamification((prev) => ({
                  ...prev,
                  dailyBudget: { ...prev.dailyBudget, amount: Math.max(0, Number(e.target.value) || 0) },
                }))
              }
              className="w-24 px-2 py-1 rounded-lg border border-slate-200 font-bold text-sm"
            />
          </label>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${budgetPct}%` }} />
          </div>
          <p className="text-[11px] text-slate-400 font-semibold">
            {formatEURPrefix(gamification.dailyBudget.spentVirtual)} allocated ·{' '}
            {formatEURPrefix(Math.max(0, gamification.dailyBudget.amount - gamification.dailyBudget.spentVirtual))}{' '}
            left — a tracker of intent, not a real payment.
          </p>
        </section>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-card p-4 space-y-2">
        <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-400">Today's quests</h2>
        <div className="space-y-1.5">
          {quests.map((q) => (
            <button
              key={q.id}
              type="button"
              disabled={q.auto}
              onClick={() => {
                if (q.auto || q.done) return;
                updateGamification((prev) => markQuestDone(prev, q.id));
              }}
              className={`w-full flex items-start gap-2 text-left px-3 py-2 rounded-xl border ${
                q.done ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'
              } ${q.auto ? 'cursor-default' : 'cursor-pointer hover:bg-slate-100'}`}
            >
              {q.done ? (
                <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <Circle size={16} className="text-slate-300 shrink-0 mt-0.5" />
              )}
              <span>
                <span className={`block text-xs font-bold ${q.done ? 'text-emerald-800' : 'text-slate-800'}`}>
                  {q.title}
                </span>
                <span className="block text-[10px] text-slate-400 font-semibold">{q.description}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-card p-4 space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-400">
            Achievements ({unlockedCount}/{achievements.length})
          </h2>
          <button
            type="button"
            onClick={() => setShowDigest(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 text-[10px] font-black uppercase tracking-wider text-slate-600 hover:bg-slate-50"
          >
            <Newspaper size={12} /> Weekly digest
          </button>
        </div>
        <AchievementGrid achievements={achievements} />
      </section>

      {showDigest && <WeeklyDigestCard digest={digest} onClose={() => setShowDigest(false)} />}
    </div>
  );
};

export default ReinvestGameTab;
