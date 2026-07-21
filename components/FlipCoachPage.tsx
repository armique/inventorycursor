import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CircleHelp,
  Lightbulb,
  ShoppingBag,
  Target,
  TrendingUp,
  Zap,
} from 'lucide-react';
import type { InventoryItem } from '../types';
import { formatEUR } from '../utils/formatMoney';
import {
  buildSellNowQueue,
  computeBuyFocus,
  DEFAULT_FLIP_FEES,
  listPricesForPocket,
  loadFlipFees,
  maxBuyForEbayFlip,
  maxBuyForKleinFlip,
  saveFlipFees,
  suggestChannelPrices,
  totalEbayFeePct,
  type FlipFeeSettings,
} from '../utils/flipCoach';

interface Props {
  items: InventoryItem[];
}

/**
 * Simple coach: what “sold comps” means, Klein vs eBay list prices,
 * what to keep buying, and what in stock to sell next.
 */
const FlipCoachPage: React.FC<Props> = ({ items }) => {
  const [fees, setFees] = useState<FlipFeeSettings>(() => loadFlipFees());
  const [lookupName, setLookupName] = useState('');
  const [minProfit, setMinProfit] = useState(30);

  const feePct = totalEbayFeePct(fees);

  const buyFocus = useMemo(() => computeBuyFocus(items, 10), [items]);
  const sellNow = useMemo(() => buildSellNowQueue(items, fees, 15), [items, fees]);

  const lookup = useMemo(() => {
    if (lookupName.trim().length < 3) return null;
    return suggestChannelPrices(items, lookupName, fees);
  }, [items, lookupName, fees]);

  const updateFees = (patch: Partial<FlipFeeSettings>) => {
    const next = {
      ebayFeePct: patch.ebayFeePct ?? fees.ebayFeePct,
      ebayAdsPct: patch.ebayAdsPct ?? fees.ebayAdsPct,
    };
    setFees(next);
    saveFlipFees(next);
  };

  const example = listPricesForPocket(100, feePct);

  return (
    <div className="max-w-5xl mx-auto space-y-5 pb-24 md:pb-10 animate-in fade-in">
      <header className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">Flip Coach</h1>
        <p className="text-sm text-slate-600 max-w-2xl leading-relaxed">
          Simple help for what to sell, for how much on <strong>Kleinanzeigen</strong> vs{' '}
          <strong>eBay</strong>, and which kinds of parts to keep buying — based on{' '}
          <em>your</em> sales.
        </p>
      </header>

      {/* What is a sold comp? */}
      <section className="rounded-2xl border border-sky-100 bg-sky-50/60 p-4 sm:p-5 space-y-2">
        <h2 className="text-sm font-black uppercase tracking-widest text-sky-900 flex items-center gap-2">
          <CircleHelp size={16} /> What does “sold comps” mean?
        </h2>
        <p className="text-sm text-slate-700 leading-relaxed">
          <strong>Comp</strong> = comparison. <strong>Sold comps</strong> = real items like yours that
          already sold — especially <em>your</em> past sales.
        </p>
        <p className="text-sm text-slate-700 leading-relaxed">
          Example: you want to price an RTX 3060. The app looks at RTX 3060s <em>you</em> already sold
          and uses those prices as a guide. That is smarter than guessing.
        </p>
        <p className="text-xs text-slate-600 leading-relaxed bg-white/70 border border-sky-100 rounded-xl px-3 py-2">
          Your eBay habit (typing the <strong>net money you received</strong>) is correct. Flip Coach
          treats that as “money in your pocket,” then calculates a higher eBay list price so fees don’t
          eat your profit. On Kleinanzeigen there are no fees, so list price ≈ pocket money.
        </p>
      </section>

      {/* Fee settings */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3">
        <h2 className="text-xs font-black uppercase tracking-widest text-slate-400">Your eBay cost %</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <label className="space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase">eBay fee %</span>
            <input
              type="number"
              min={0}
              max={30}
              step={0.5}
              value={fees.ebayFeePct}
              onChange={(e) => updateFees({ ebayFeePct: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 font-bold text-sm outline-none focus:border-rose-400"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase">Ads %</span>
            <input
              type="number"
              min={0}
              max={30}
              step={0.5}
              value={fees.ebayAdsPct}
              onChange={(e) => updateFees({ ebayAdsPct: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 font-bold text-sm outline-none focus:border-rose-400"
            />
          </label>
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase">Total eBay cut</span>
            <p className="px-3 py-2 rounded-xl bg-rose-50 border border-rose-100 font-black text-sm text-rose-800">
              {feePct.toFixed(1)}%
            </p>
          </div>
          <label className="space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase">Min profit €</span>
            <input
              type="number"
              min={0}
              step={5}
              value={minProfit}
              onChange={(e) => setMinProfit(Number(e.target.value) || 0)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 font-bold text-sm outline-none focus:border-emerald-400"
            />
          </label>
        </div>
        <p className="text-xs text-slate-500">
          Example: if you want <strong>€100 in your pocket</strong> → list ~€{formatEUR(example.kleinanzeigen)}{' '}
          on Kleinanzeigen, or ~€{formatEUR(example.ebay)} on eBay (so after {feePct.toFixed(0)}% you still
          keep ~€100).
        </p>
      </section>

      {/* Price lookup */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3">
        <h2 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
          <Target size={14} className="text-emerald-600" /> Price idea (Klein + eBay)
        </h2>
        <input
          value={lookupName}
          onChange={(e) => setLookupName(e.target.value)}
          placeholder="e.g. ASUS Dual RTX 3060 12GB"
          className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 font-bold text-sm outline-none focus:border-emerald-400 focus:bg-white"
        />
        {lookup && lookup.compCount > 0 && (
          <div className="space-y-3">
            <p className="text-xs text-slate-600">{lookup.note}</p>
            <p className="text-xs font-bold text-slate-500">
              Your sold comps: €{formatEUR(lookup.low)} – €{formatEUR(lookup.high)} · median pocket €
              {formatEUR(lookup.median)} ({lookup.compCount} sales)
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-800">
                  Kleinanzeigen (0% fees)
                </p>
                <p className="text-2xl font-black text-emerald-900 mt-1">€{formatEUR(lookup.kleinList)}</p>
                <p className="text-[11px] text-emerald-800/80 mt-1">
                  You keep ~€{formatEUR(lookup.pocketTarget)} · max buy for €{formatEUR(minProfit)} profit: €
                  {formatEUR(maxBuyForKleinFlip(lookup.kleinList, minProfit))}
                </p>
              </div>
              <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-800">
                  eBay (after {feePct.toFixed(0)}% fees+ads)
                </p>
                <p className="text-2xl font-black text-blue-900 mt-1">€{formatEUR(lookup.ebayList)}</p>
                <p className="text-[11px] text-blue-800/80 mt-1">
                  Aim to still pocket ~€{formatEUR(lookup.pocketTarget)} · max buy for €{formatEUR(minProfit)}{' '}
                  profit: €{formatEUR(maxBuyForEbayFlip(lookup.ebayList, feePct, minProfit))}
                </p>
              </div>
            </div>
          </div>
        )}
        {lookup && lookup.compCount === 0 && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
            {lookup.note}
          </p>
        )}
      </section>

      {/* Keep buying */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3">
        <h2 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
          <TrendingUp size={14} className="text-violet-600" /> Keep buying these
        </h2>
        <p className="text-xs text-slate-500">
          From your sold history: good pocket profit + sold relatively fast. Focus your next buys here.
        </p>
        {buyFocus.length === 0 ? (
          <p className="text-sm text-slate-500">
            Need at least a few sold items with buy + sell dates. Keep marking sales — this fills in.
          </p>
        ) : (
          <div className="space-y-2">
            {buyFocus.map((row) => (
              <div
                key={row.category}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 border border-slate-100"
              >
                <div className="min-w-0">
                  <p className="text-sm font-black text-slate-900">{row.category}</p>
                  <p className="text-[11px] text-slate-500">
                    {row.soldCount} sold · ~{row.avgDaysToSell}d · avg profit €{formatEUR(row.avgPocketProfit)} ·{' '}
                    {row.inStock} in stock
                  </p>
                </div>
                <span
                  className={`shrink-0 text-[10px] font-black uppercase px-2.5 py-1 rounded-lg ${
                    row.advice.startsWith('Buy more') || row.advice.startsWith('Keep')
                      ? 'bg-emerald-100 text-emerald-800'
                      : row.advice.startsWith('Slow')
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {row.advice}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Sell now */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3">
        <h2 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
          <Zap size={14} className="text-amber-500" /> Sell these next
        </h2>
        <p className="text-xs text-slate-500">
          Your in-stock items with suggested Klein + eBay prices. Older stock rises to the top.
        </p>
        {sellNow.length === 0 ? (
          <p className="text-sm text-slate-500">No in-stock items to rank yet.</p>
        ) : (
          <div className="space-y-2">
            {sellNow.map((row) => (
              <div
                key={row.item.id}
                className="p-3 rounded-xl border border-slate-100 bg-slate-50/80 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-900 truncate">{row.item.name}</p>
                    <p className="text-[11px] text-slate-500">
                      Buy €{formatEUR(row.item.buyPrice || 0)} · held {row.daysHeld}d
                      {row.compCount ? ` · ${row.compCount} comps` : ' · few comps'}
                    </p>
                  </div>
                  <Link
                    to={`/panel/edit/${row.item.id}`}
                    className="shrink-0 inline-flex items-center gap-1 text-[10px] font-black uppercase text-blue-700"
                  >
                    Open <ArrowRight size={12} />
                  </Link>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-2.5 py-2">
                    <p className="text-[9px] font-black uppercase text-emerald-700">Klein list</p>
                    <p className="text-sm font-black text-emerald-900">€{formatEUR(row.kleinList)}</p>
                    <p className="text-[10px] text-emerald-800">
                      ~€{formatEUR(row.estimatedPocketProfitKlein)} profit
                    </p>
                  </div>
                  <div className="rounded-lg bg-blue-50 border border-blue-100 px-2.5 py-2">
                    <p className="text-[9px] font-black uppercase text-blue-700">eBay list</p>
                    <p className="text-sm font-black text-blue-900">€{formatEUR(row.ebayList)}</p>
                    <p className="text-[10px] text-blue-800">
                      ~€{formatEUR(row.estimatedPocketProfitEbay)} profit after fees
                    </p>
                  </div>
                </div>
                <p className="text-[11px] text-slate-600 flex items-start gap-1.5">
                  <ShoppingBag size={12} className="mt-0.5 shrink-0 text-slate-400" />
                  <span>
                    Prefer{' '}
                    <strong>
                      {row.preferredChannel === 'kleinanzeigen.de'
                        ? 'Kleinanzeigen'
                        : row.preferredChannel === 'ebay.de'
                          ? 'eBay'
                          : 'either channel'}
                    </strong>
                    {' — '}
                    {row.reason}
                  </span>
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Simple strategy */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-2">
        <h2 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
          <Lightbulb size={14} className="text-amber-500" /> Simple weekly strategy
        </h2>
        <ol className="text-sm text-slate-700 space-y-1.5 list-decimal pl-5 leading-relaxed">
          <li>Only buy if max-buy (above) still leaves you ≥ €{formatEUR(minProfit)} profit.</li>
          <li>List the same day parts arrive — cash beats perfect prices.</li>
          <li>Use Kleinanzeigen when eBay fees would kill the deal; use eBay for searchable popular models.</li>
          <li>Every week: sell the top of “Sell these next,” cut price on anything &gt;45 days.</li>
          <li>Reinvest only from money you already received — not from “maybe” stock value.</li>
        </ol>
        <p className="text-xs text-slate-500 pt-1">
          Hard times are real. Focus on small, fast wins in your best categories — consistency beats one big
          gamble.
        </p>
      </section>
    </div>
  );
};

export default FlipCoachPage;
