import React, { useMemo, useState } from 'react';
import type { InventoryItem } from '../types';
import { formatEUR } from '../utils/formatMoney';
import { DEFAULT_SHIPPING_EUR, quoteMaxBuy, type FulfillmentMode } from '../utils/maxBuyCeiling';

type Props = {
  items: InventoryItem[];
  compact?: boolean;
};

const MaxBuyPanel: React.FC<Props> = ({ items, compact }) => {
  const [query, setQuery] = useState('');
  const [ask, setAsk] = useState('');
  const [mode, setMode] = useState<FulfillmentMode>('pickup');
  const [ship, setShip] = useState(String(DEFAULT_SHIPPING_EUR));

  const quote = useMemo(() => {
    const askN = parseFloat(ask.replace(',', '.'));
    const shipN = parseFloat(ship.replace(',', '.'));
    return quoteMaxBuy(items, query, {
      askPrice: Number.isFinite(askN) && askN > 0 ? askN : undefined,
      fulfillment: mode,
      shippingEur: Number.isFinite(shipN) ? shipN : DEFAULT_SHIPPING_EUR,
    });
  }, [items, query, ask, mode, ship]);

  const tone =
    quote.verdict === 'skip'
      ? 'border-rose-200 bg-rose-50 text-rose-950'
      : quote.verdict === 'buy'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
        : quote.verdict === 'borderline'
          ? 'border-amber-200 bg-amber-50 text-amber-950'
          : 'border-slate-200 bg-slate-50 text-slate-700';

  return (
    <div className={`rounded-2xl border border-slate-200 bg-white ${compact ? 'p-3' : 'p-4'}`}>
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
        Max buy — before you open the chat
      </p>
      <div className={`grid gap-2 ${compact ? 'grid-cols-1' : 'sm:grid-cols-2'}`}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="What is it? RTX 3070, B450…"
          className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-semibold"
        />
        <input
          value={ask}
          onChange={(e) => setAsk(e.target.value.replace(',', '.'))}
          inputMode="decimal"
          placeholder="Their ask €"
          className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-semibold"
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setMode('pickup')}
          className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase border ${
            mode === 'pickup' ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-500'
          }`}
        >
          I pick up
        </button>
        <button
          type="button"
          onClick={() => setMode('ship')}
          className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase border ${
            mode === 'ship' ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-500'
          }`}
        >
          They ship
        </button>
        {mode === 'ship' && (
          <input
            value={ship}
            onChange={(e) => setShip(e.target.value.replace(',', '.'))}
            className="w-20 px-2 py-1 rounded-lg border border-slate-200 text-xs font-bold"
            aria-label="Shipping €"
          />
        )}
      </div>
      <div className={`mt-3 rounded-xl border px-3 py-2 text-xs font-semibold ${tone}`}>
        {query.trim().length < 3 ? (
          'Type the product — max buy = sold median × 55% − shipping − 14-day risk.'
        ) : (
          <>
            <span className="font-black tabular-nums">
              Max €{formatEUR(quote.maxBuy)}
              {quote.compCount ? ` · ${quote.compCount} comps` : ''}
            </span>
            <span className="block mt-0.5 font-medium opacity-80">{quote.reason}</span>
          </>
        )}
      </div>
    </div>
  );
};

export default MaxBuyPanel;
