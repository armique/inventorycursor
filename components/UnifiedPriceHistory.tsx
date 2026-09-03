import React from 'react';
import { formatEUR } from '../utils/formatMoney';
import type { InventoryItem, PriceHistoryEntry } from '../types';

function formatHistDate(iso: string | undefined): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso.slice(0, 10);
  return `${m[3]}.${m[2]}.${m[1]}`;
}

function formatPriceDelta(entry: PriceHistoryEntry): string {
  const prev = entry.previousPrice;
  const next = entry.price;
  if (prev == null || Math.abs(prev - next) < 0.005) {
    return `€${formatEUR(next)}`;
  }
  const delta =
    entry.delta != null ? entry.delta : Math.round((next - prev) * 100) / 100;
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  return `€${formatEUR(prev)} → €${formatEUR(next)} (${sign}€${formatEUR(Math.abs(delta))})`;
}

const TYPE_LABEL: Record<PriceHistoryEntry['type'], string> = {
  buy: 'Buy (EK)',
  sell: 'Sold (VK)',
  storePrice: 'Store price',
};

/** Full price audit — buy + sell + store with explicit deltas. */
const UnifiedPriceHistory: React.FC<{ item: InventoryItem }> = ({ item }) => {
  const rows = (item.priceHistory || []).filter(
    (e) => e.type === 'buy' || e.type === 'sell' || e.type === 'storePrice'
  );

  if (!rows.length) {
    return (
      <p className="text-xs text-slate-500 font-medium">No documented price changes yet.</p>
    );
  }

  return (
    <ol className="space-y-2">
      {[...rows].reverse().map((entry, idx) => (
        <li
          key={`${entry.date}-${entry.type}-${idx}`}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">
              {TYPE_LABEL[entry.type]}
            </span>
            <span className="text-[10px] font-bold text-slate-400">
              {formatHistDate(entry.date)}
            </span>
          </div>
          <p className="text-sm font-black text-slate-900 mt-0.5 tabular-nums">
            {formatPriceDelta(entry)}
          </p>
          {entry.reasonLabel ? (
            <p className="text-[11px] text-slate-600 mt-0.5">{entry.reasonLabel}</p>
          ) : null}
        </li>
      ))}
    </ol>
  );
};

export default UnifiedPriceHistory;
