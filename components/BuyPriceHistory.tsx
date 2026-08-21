import React, { useState } from 'react';
import { TrendingUp } from 'lucide-react';
import type { InventoryItem } from '../types';
import { formatEUR } from '../utils/formatMoney';
import {
  hasRestockBuyPriceBump,
  latestBuyPriceIncrease,
  listBuyPriceHistory,
} from '../services/priceHistory';

function formatHistDate(iso: string | undefined): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso.slice(0, 10);
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/** Chip + expandable list of buy-price changes (esp. restock / Erstattet EK bumps). */
const BuyPriceHistory: React.FC<{ item: InventoryItem; compact?: boolean }> = ({ item, compact }) => {
  const buys = listBuyPriceHistory(item);
  const bump = latestBuyPriceIncrease(item);
  const restockBump = hasRestockBuyPriceBump(item);
  const [open, setOpen] = useState(false);

  if (!buys.length && !bump) return null;

  const chipLabel = bump
    ? restockBump
      ? `EK +€${formatEUR(bump.delta)}`
      : `EK was €${formatEUR(bump.previousPrice)}`
    : `EK history · ${buys.length}`;

  return (
    <div className={compact ? 'mt-1' : 'mt-2'}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wide rounded-lg px-2 py-1 border ${
          restockBump
            ? 'text-amber-900 bg-amber-50 border-amber-300 hover:bg-amber-100'
            : 'text-slate-700 bg-slate-50 border-slate-200 hover:bg-slate-100'
        }`}
        title={
          bump
            ? `${bump.reasonLabel}\n€${formatEUR(bump.previousPrice)} → €${formatEUR(bump.price)}`
            : 'Buy price history'
        }
      >
        <TrendingUp size={10} className="shrink-0" />
        {chipLabel}
      </button>
      {open && (
        <ol className="mt-1.5 space-y-1.5 pl-0.5">
          {[...buys].reverse().map((entry, idx) => {
            const delta =
              entry.delta != null
                ? entry.delta
                : entry.previousPrice != null
                  ? entry.price - entry.previousPrice
                  : null;
            return (
              <li
                key={`${entry.date}-${idx}`}
                className="text-[10px] leading-snug text-slate-700 bg-slate-50 border border-slate-100 rounded-lg px-2 py-1.5"
              >
                <p className="font-black text-slate-900">
                  {formatHistDate(entry.date)}
                  {delta != null && Math.abs(delta) >= 0.01 ? (
                    <span className={delta > 0 ? 'text-amber-800' : 'text-emerald-800'}>
                      {' '}
                      · {delta > 0 ? '+' : '−'}€{formatEUR(Math.abs(delta))}
                    </span>
                  ) : null}
                </p>
                <p>
                  {entry.previousPrice != null
                    ? `€${formatEUR(entry.previousPrice)} → €${formatEUR(entry.price)}`
                    : `€${formatEUR(entry.price)}`}
                </p>
                <p className="text-amber-900 font-bold">
                  {entry.reasonLabel ||
                    (entry.reason === 'restock_loss'
                      ? 'Unsold / return — loss added to EK'
                      : entry.reason === 'hub_erstattet'
                        ? 'Erstattet — fees/shipping added to EK'
                        : entry.reason === 'refund_capitalize'
                          ? 'Full refund — capitalized into EK'
                          : entry.reason === 'manual'
                            ? 'Manual edit'
                            : 'Buy price change')}
                  {entry.orderId ? ` · #${entry.orderId}` : ''}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
};

/** Inline +€delta next to the buy price when restock capitalized loss into EK. */
export const BuyPriceBumpBadge: React.FC<{ item: InventoryItem }> = ({ item }) => {
  const bump = latestBuyPriceIncrease(item);
  if (!bump || !hasRestockBuyPriceBump(item)) return null;
  return (
    <span
      className="ml-1 inline-flex items-center rounded px-1 py-0.5 text-[9px] font-black uppercase tracking-wide text-amber-900 bg-amber-100 border border-amber-300"
      title={`${bump.reasonLabel}\n€${formatEUR(bump.previousPrice)} → €${formatEUR(bump.price)}`}
    >
      +€{formatEUR(bump.delta)}
    </span>
  );
};

export default BuyPriceHistory;
