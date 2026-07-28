import React from 'react';
import {
  Star,
  Medal,
  Trophy,
  Crown,
  Zap,
  Flame,
  Layers,
  TrendingUp,
  CalendarCheck,
  Boxes,
  Globe,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import type { Achievement } from '../../utils/gamification';

const ICONS: Record<string, LucideIcon> = {
  star: Star,
  medal: Medal,
  trophy: Trophy,
  crown: Crown,
  zap: Zap,
  flame: Flame,
  layers: Layers,
  'trending-up': TrendingUp,
  'calendar-check': CalendarCheck,
  boxes: Boxes,
  globe: Globe,
  'shield-check': ShieldCheck,
  sparkles: Sparkles,
};

type Props = {
  achievements: Achievement[];
};

const AchievementGrid: React.FC<Props> = ({ achievements }) => (
  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
    {achievements.map((a) => {
      const Icon = ICONS[a.icon] || Star;
      return (
        <div
          key={a.id}
          className={`rounded-xl border p-2.5 space-y-1.5 ${
            a.unlocked ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'
          }`}
          title={a.description}
        >
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-flex p-1.5 rounded-lg ${
                a.unlocked ? 'bg-amber-400 text-white' : 'bg-slate-200 text-slate-400'
              }`}
            >
              <Icon size={14} />
            </span>
            <span className={`text-[11px] font-black truncate ${a.unlocked ? 'text-slate-900' : 'text-slate-500'}`}>
              {a.label}
            </span>
          </div>
          <div className="h-1 rounded-full bg-slate-200 overflow-hidden">
            <div
              className={`h-full rounded-full ${a.unlocked ? 'bg-amber-400' : 'bg-slate-400'}`}
              style={{ width: `${a.progress}%` }}
            />
          </div>
          <p className="text-[9px] font-bold text-slate-400">{a.progressLabel}</p>
        </div>
      );
    })}
  </div>
);

export default AchievementGrid;
