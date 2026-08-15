import React from 'react';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';

export const COCKPIT_STEPS = [
  { id: 'job', n: '01', label: 'Job' },
  { id: 'print', n: '02', label: 'Print' },
  { id: 'material', n: '03', label: 'Material' },
  { id: 'checkout', n: '04', label: 'Checkout' },
] as const;

export type CockpitStepIndex = 0 | 1 | 2 | 3;

type RailProps = {
  step: number;
  summaries: [string, string, string, string];
  onSelect: (index: number) => void;
};

export const ThreeDPrintCockpitRail: React.FC<RailProps> = ({ step, summaries, onSelect }) => (
  <nav aria-label="Print job steps" className="lg:sticky lg:top-2">
    <div className="flex lg:flex-col gap-2 overflow-x-auto pb-1 lg:pb-0">
      {COCKPIT_STEPS.map((s, i) => {
        const active = i === step;
        const done = i < step;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(i)}
            className={`min-w-[10.5rem] lg:min-w-0 text-left rounded-2xl px-3 py-3 transition-colors ${
              active
                ? 'bg-[#1a2740] ring-2 ring-brand-500 shadow-[0_0_0_1px_rgba(10,132,255,0.35)]'
                : 'bg-transparent hover:bg-white/5'
            }`}
          >
            <div className="flex items-center gap-3">
              <span
                className={`w-9 h-9 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${
                  done
                    ? 'bg-brand-500 text-white'
                    : active
                      ? 'bg-brand-500 text-white'
                      : 'bg-[#243044] text-slate-400'
                }`}
              >
                {done ? <Check size={16} strokeWidth={2.5} /> : s.n}
              </span>
              <div className="min-w-0">
                <p className={`text-sm font-semibold ${active || done ? 'text-white' : 'text-slate-400'}`}>
                  {s.label}
                </p>
                {summaries[i] && (
                  <p className={`text-[11px] truncate ${active ? 'text-slate-300' : 'text-slate-500'}`}>
                    {summaries[i]}
                  </p>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  </nav>
);

type FooterProps = {
  step: number;
  total: number;
  continueLabel: string;
  disableContinue?: boolean;
  onBack: () => void;
  onContinue: () => void;
};

export const ThreeDPrintCockpitFooter: React.FC<FooterProps> = ({
  step,
  total,
  continueLabel,
  disableContinue,
  onBack,
  onContinue,
}) => (
  <div className="mt-auto flex items-center gap-3 border-t border-white/10 px-4 py-3 sm:px-5">
    <button
      type="button"
      onClick={onBack}
      disabled={step === 0}
      className="inline-flex items-center gap-1 h-11 px-4 rounded-xl bg-[#243044] text-sm font-semibold text-slate-200 hover:bg-[#2c3a52] disabled:opacity-30 disabled:pointer-events-none"
    >
      <ChevronLeft size={16} />
      Back
    </button>
    <p className="flex-1 text-center text-sm text-slate-400">
      Step {step + 1} of {total}
    </p>
    <button
      type="button"
      onClick={onContinue}
      disabled={disableContinue}
      className="inline-flex items-center gap-1.5 h-11 px-5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold disabled:opacity-40 disabled:pointer-events-none"
    >
      {continueLabel}
      {step < total - 1 && <ChevronRight size={16} />}
    </button>
  </div>
);
