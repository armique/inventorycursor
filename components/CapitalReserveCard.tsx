import React, { useState } from 'react';
import { formatEUR } from '../utils/formatMoney';
import {
  freeToSpend,
  loadCapitalReserve,
  saveCapitalReserve,
  untouchableCapital,
  type CapitalReserveSettings,
} from '../utils/capitalReserve';

type Props = {
  cashOnHand: number;
};

const CapitalReserveCard: React.FC<Props> = ({ cashOnHand }) => {
  const [settings, setSettings] = useState<CapitalReserveSettings>(() => loadCapitalReserve());
  const [open, setOpen] = useState(false);

  const patch = (next: CapitalReserveSettings) => {
    setSettings(next);
    saveCapitalReserve(next);
  };

  const locked = untouchableCapital(settings);
  const free = freeToSpend(cashOnHand, settings);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Untouchable capital</p>
          <p className="text-lg font-black tabular-nums text-slate-900 mt-0.5">
            Free €{formatEUR(free)}
          </p>
          <p className="text-[11px] font-semibold text-slate-500">
            Cash €{formatEUR(cashOnHand)} · reserve €{formatEUR(locked)} (tax + filament + {settings.weeks}w living)
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-[10px] font-black uppercase text-slate-500"
        >
          {open ? 'Hide' : 'Edit'}
        </button>
      </div>
      {open && (
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(
            [
              ['taxReserve', 'Tax €'],
              ['filamentReserve', 'Filament €'],
              ['livingWeekly', 'Living / week €'],
              ['weeks', 'Weeks'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="text-[10px] font-bold text-slate-500">
              {label}
              <input
                type="number"
                min={0}
                value={settings[key]}
                onChange={(e) =>
                  patch({ ...settings, [key]: Math.max(0, parseFloat(e.target.value) || 0) })
                }
                className="mt-1 w-full px-2 py-1.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-900"
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

export default CapitalReserveCard;
