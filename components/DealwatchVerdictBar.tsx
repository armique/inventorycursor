import React, { useMemo, useState } from 'react';
import {
  dealwatchFilterHitRates,
  loadDealwatchVerdicts,
  saveDealwatchVerdict,
  type DealwatchVerdictKind,
} from '../utils/dealwatchVerdicts';

const KINDS: { id: DealwatchVerdictKind; label: string }[] = [
  { id: 'bought', label: 'Bought' },
  { id: 'expensive', label: 'Too expensive' },
  { id: 'fake', label: 'Fake' },
  { id: 'gone', label: 'Gone' },
];

const DealwatchVerdictBar: React.FC = () => {
  const [title, setTitle] = useState('');
  const [filter, setFilter] = useState('');
  const [ask, setAsk] = useState('');
  const [rows, setRows] = useState(() => loadDealwatchVerdicts());

  const rates = useMemo(() => dealwatchFilterHitRates(rows).slice(0, 4), [rows]);

  const log = (verdict: DealwatchVerdictKind) => {
    if (!title.trim()) return;
    const askN = parseFloat(ask.replace(',', '.'));
    setRows(
      saveDealwatchVerdict({
        title: title.trim(),
        filter: filter.trim(),
        verdict,
        ...(Number.isFinite(askN) && askN > 0 ? { askPrice: askN } : {}),
      }),
    );
    setTitle('');
    setAsk('');
  };

  return (
    <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Listing you just looked at"
          className="flex-1 min-w-[10rem] px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold"
        />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter (rtx 3070 · KA)"
          className="w-40 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold"
        />
        <input
          value={ask}
          onChange={(e) => setAsk(e.target.value.replace(',', '.'))}
          placeholder="Ask €"
          className="w-20 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold"
        />
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            onClick={() => log(k.id)}
            className="px-2 py-1.5 rounded-lg border border-slate-200 text-[10px] font-black uppercase text-slate-600 hover:bg-slate-50"
          >
            {k.label}
          </button>
        ))}
      </div>
      {rates.length > 0 && (
        <p className="text-[10px] font-bold text-slate-500 truncate">
          Filters that feed:{' '}
          {rates.map((r) => `${r.filter} ${Math.round(r.buyRate * 100)}% buy (${r.total})`).join(' · ')}
        </p>
      )}
    </div>
  );
};

export default DealwatchVerdictBar;
