import React from 'react';

export interface EbayToolProgress {
  label: string;
  done: number;
  total: number;
  detail?: string;
}

interface Props extends EbayToolProgress {
  tone?: 'blue' | 'indigo' | 'rose' | 'emerald' | 'amber';
}

const TONE_BAR: Record<NonNullable<Props['tone']>, string> = {
  blue: 'bg-blue-600',
  indigo: 'bg-indigo-600',
  rose: 'bg-rose-600',
  emerald: 'bg-emerald-600',
  amber: 'bg-amber-500',
};

const EbayToolProgressBar: React.FC<Props> = ({ label, done, total, detail, tone = 'blue' }) => {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/90 px-4 py-3 space-y-2 shadow-sm">
      <div className="flex justify-between items-center gap-3 text-xs font-bold text-slate-700">
        <span>{label}</span>
        <span className="text-slate-500 tabular-nums shrink-0">
          {done} / {total} · {pct}%
        </span>
      </div>
      <div className="h-2.5 bg-slate-200 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-300 ease-out ${TONE_BAR[tone]}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {detail ? (
        <p className="text-[10px] text-slate-500 truncate font-medium" title={detail}>
          {detail}
        </p>
      ) : null}
    </div>
  );
};

export default EbayToolProgressBar;
