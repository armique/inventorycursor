import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bookmark, Camera, Clock, Copy, ShoppingBag } from 'lucide-react';
import type { InventoryItem, ItemUpdateOptions } from '../types';
import { ItemStatus } from '../types';
import { formatEUR } from '../utils/formatMoney';
import { buildSellTodayRows, itemPhotosReady } from '../utils/sellToday';
import { cheapSuggestLists, isMaybeSoldCandidate, maybeSoldLabel } from '../utils/listingWatch';
import { suggestionPatchFromPrice } from '../utils/flipInsights';
import { loadFlipFees, totalEbayFeePct } from '../utils/flipCoach';
import { buildListingTemplate, copyListingTemplate } from '../utils/listingTemplate';
import { buildWhyNotSelling, todaysWeeklyLane, weeklyLaneItems, type WeeklyLane } from '../utils/sellDesk';
import { suggestDeadStockCombos } from '../utils/deadStockCombos';
import { computeRepeatWinners } from '../utils/repeatWinners';
import { useUndoToastContext } from '../context/UndoToastContext';
import MaxBuyPanel from './MaxBuyPanel';

type Props = {
  items: InventoryItem[];
  onUpdate: (items: InventoryItem[], deleteIds?: string[], options?: ItemUpdateOptions) => void;
};

const LANE_META: Record<WeeklyLane, { title: string; hint: string }> = {
  photos: { title: 'Mon · Photos', hint: 'Shoot these first' },
  list: { title: 'Wed · List', hint: 'Photos ready, not posted' },
  drop: { title: 'Sat · Drop', hint: 'Listed 21+ days' },
};

const SellTodayPage: React.FC<Props> = ({ items, onUpdate }) => {
  const navigate = useNavigate();
  const { showUndo } = useUndoToastContext();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [soldPriceById, setSoldPriceById] = useState<Record<string, string>>({});

  const rows = useMemo(() => buildSellTodayRows(items), [items]);
  const forgotten = useMemo(() => items.filter(isMaybeSoldCandidate).slice(0, 5), [items]);
  const lanes = useMemo(() => weeklyLaneItems(items), [items]);
  const focusLane = todaysWeeklyLane();
  const stuck = useMemo(() => buildWhyNotSelling(items, 10), [items]);
  const combos = useMemo(() => suggestDeadStockCombos(items, 4), [items]);
  const winners = useMemo(() => computeRepeatWinners(items, 6), [items]);

  const applySuggest = (item: InventoryItem) => {
    const s = cheapSuggestLists(item, items);
    if (!s) return;
    const fees = loadFlipFees();
    onUpdate(
      [
        {
          ...item,
          sellPrice: s.klein,
          ...suggestionPatchFromPrice({
            ebayList: s.ebay,
            kleinList: s.klein,
            pocketTarget: s.klein,
            feePct: totalEbayFeePct(fees),
            compCount: 0,
            fromSnapshot: false,
            targetMargin: s.targetMargin,
            daysHeld: s.daysHeld,
          }),
        },
      ],
      undefined,
      { skipActionLog: true },
    );
  };

  const copyAd = async (item: InventoryItem) => {
    const s = cheapSuggestLists(item, items);
    const klein = s?.klein || Number(item.sellPrice) || 0;
    const ebay = s?.ebay || klein;
    const ok = await copyListingTemplate(buildListingTemplate(item, { klein, ebay }).text);
    if (ok) {
      setCopiedId(item.id);
      window.setTimeout(() => setCopiedId((id) => (id === item.id ? null : id)), 1600);
    }
  };

  const markForgottenSold = (item: InventoryItem) => {
    const typed = parseFloat((soldPriceById[item.id] || '').replace(',', '.'));
    const sellPrice =
      (Number.isFinite(typed) && typed > 0 ? typed : null) ||
      item.liveEbayListPrice ||
      item.liveKleinListPrice ||
      item.sellPrice ||
      0;
    const prev = { ...item };
    onUpdate(
      [
        {
          ...item,
          status: ItemStatus.SOLD,
          sellDate: new Date().toISOString().split('T')[0],
          sellPrice,
          maybeSoldHint: undefined,
          storeVisible: false,
        },
      ],
      undefined,
      { skipActionLog: true },
    );
    showUndo('Marked sold', () => onUpdate([prev], undefined, { skipActionLog: true, skipUndo: true }));
  };

  return (
    <div className="max-w-5xl mx-auto w-full pb-24 md:pb-8 animate-in fade-in space-y-5">
      <header>
        <h1 className="text-2xl sm:text-3xl font-display font-black tracking-tight text-slate-900">
          Sell today
        </h1>
        <p className="text-sm font-semibold text-slate-500 mt-1">
          Price, list, drop — one screen. Age-aware KA / eBay without opening the card.
        </p>
      </header>

      {forgotten.length > 0 && (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-3 space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-rose-800">
            Listing vanished — mark sold?
          </p>
          {forgotten.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-white border border-rose-100 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black text-slate-900 truncate">{item.name}</p>
                <p className="text-[11px] font-semibold text-rose-700">{maybeSoldLabel(item.maybeSoldHint)}</p>
              </div>
              <input
                value={soldPriceById[item.id] || ''}
                onChange={(e) => setSoldPriceById((m) => ({ ...m, [item.id]: e.target.value }))}
                placeholder={`€${Math.round(item.liveEbayListPrice || item.sellPrice || 0) || 'sold'}`}
                className="w-20 px-2 py-1 rounded-lg border border-rose-200 text-xs font-bold"
              />
              <button
                type="button"
                onClick={() => markForgottenSold(item)}
                className="px-2 py-1 rounded-lg bg-rose-700 text-white text-[10px] font-black uppercase"
              >
                Sold
              </button>
              <button
                type="button"
                onClick={() =>
                  onUpdate([{ ...item, maybeSoldHint: undefined }], undefined, { skipActionLog: true })
                }
                className="px-2 py-1 rounded-lg border border-slate-200 text-[10px] font-black uppercase text-slate-600"
              >
                Still listed
              </button>
              <button
                type="button"
                onClick={() =>
                  onUpdate(
                    [{ ...item, maybeSoldDismissedAt: new Date().toISOString() }],
                    undefined,
                    { skipActionLog: true },
                  )
                }
                className="px-2 py-1 text-[10px] font-bold uppercase text-slate-400"
              >
                Dismiss
              </button>
            </div>
          ))}
        </section>
      )}

      <section className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {(Object.keys(LANE_META) as WeeklyLane[]).map((lane) => {
          const meta = LANE_META[lane];
          const list = lanes[lane];
          const active = focusLane === lane;
          return (
            <div
              key={lane}
              className={`rounded-2xl border p-3 ${
                active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white'
              }`}
            >
              <p className={`text-[10px] font-black uppercase tracking-widest ${active ? 'text-slate-300' : 'text-slate-400'}`}>
                {meta.title}
              </p>
              <p className={`text-[11px] font-semibold mb-2 ${active ? 'text-slate-300' : 'text-slate-500'}`}>
                {meta.hint} · {list.length}
              </p>
              <div className="space-y-1">
                {list.slice(0, 5).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigate(`/panel/edit/${item.id}`)}
                    className={`w-full text-left text-xs font-bold truncate ${active ? 'text-white' : 'text-slate-800'}`}
                  >
                    {item.name}
                  </button>
                ))}
                {list.length === 0 && (
                  <p className={`text-[11px] ${active ? 'text-slate-400' : 'text-slate-400'}`}>Clear</p>
                )}
              </div>
            </div>
          );
        })}
      </section>

      {stuck.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
            Why it is not selling
          </p>
          <div className="space-y-1.5">
            {stuck.map((row) => (
              <button
                key={row.item.id}
                type="button"
                onClick={() => navigate(`/panel/edit/${row.item.id}`)}
                className="w-full flex items-center justify-between gap-2 text-left"
              >
                <span className="text-sm font-bold text-slate-800 truncate">{row.item.name}</span>
                <span className="text-[11px] font-semibold text-slate-500 shrink-0">
                  {row.ageDays}d · {row.label}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {combos.length > 0 && (
        <section className="rounded-2xl border border-violet-200 bg-violet-50 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-widest text-violet-800">
              Bundle sitting stock
            </p>
            <button
              type="button"
              onClick={() => navigate('/panel/combo-lab')}
              className="text-[10px] font-black uppercase text-violet-700"
            >
              Combo Lab
            </button>
          </div>
          {combos.map((c) => (
            <div key={c.id} className="rounded-xl bg-white border border-violet-100 px-3 py-2">
              <p className="text-xs font-black text-slate-900">
                {c.items.map((i) => i.name).join(' + ')}
              </p>
              <p className="text-[11px] font-semibold text-violet-800 mt-0.5">
                {c.liftNote} · kit €{formatEUR(c.bundleKa)} vs parts €{formatEUR(c.separateKa)}
              </p>
            </div>
          ))}
        </section>
      )}

      {winners.length > 0 && (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-emerald-800 mb-2">
            Repeat winners · &gt;30% in under 14 days
          </p>
          <div className="flex flex-wrap gap-2">
            {winners.map((w) => (
              <span
                key={w.key}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-emerald-100 text-[11px] font-bold text-emerald-950"
              >
                {w.label}
                <span className="text-emerald-600 font-semibold">
                  {w.soldCount}× · {w.avgDays}d · {w.avgMarginPct}%
                  {w.inStock === 0 ? ' · buy' : ''}
                </span>
              </span>
            ))}
          </div>
        </section>
      )}

      <MaxBuyPanel items={items} compact />

      <section className="space-y-2">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
          Push list · {rows.length}
        </p>
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500">
            Nothing in stock to push today. Reserved items are hidden.
          </div>
        ) : (
          rows.map((row) => {
            const { item } = row;
            const suggest = cheapSuggestLists(item, items);
            return (
              <div
                key={item.id}
                className="rounded-2xl border border-slate-200 bg-white px-3 py-3 sm:px-4 flex flex-col sm:flex-row sm:items-center gap-3"
              >
                <button
                  type="button"
                  onClick={() => navigate(`/panel/edit/${item.id}`)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="text-sm font-black text-slate-900 truncate">{item.name}</p>
                  <p className="text-[11px] font-semibold text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2">
                    <span className="inline-flex items-center gap-1">
                      <Clock size={11} /> {row.ageDays}d
                    </span>
                    <span>
                      {row.marginPct.toFixed(0)}% · €{formatEUR(row.profit)}
                    </span>
                    {suggest && (
                      <span className="text-slate-700">
                        KA €{Math.round(suggest.klein)} · EB €{Math.round(suggest.ebay)}
                      </span>
                    )}
                  </p>
                </button>
                <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                  {suggest && (
                    <button
                      type="button"
                      onClick={() => applySuggest(item)}
                      className="px-2 py-1 rounded-lg bg-slate-900 text-white text-[10px] font-black uppercase"
                    >
                      Set KA €{Math.round(suggest.klein)}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void copyAd(item)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 text-[10px] font-black uppercase text-slate-600"
                  >
                    <Copy size={11} /> {copiedId === item.id ? 'Copied' : 'Ad'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdate(
                        [{ ...item, photosReady: !itemPhotosReady(item) }],
                        undefined,
                        { skipActionLog: true },
                      )
                    }
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-black uppercase ${
                      row.photosReady
                        ? 'bg-violet-50 text-violet-800 border-violet-200'
                        : 'bg-slate-50 text-slate-400 border-slate-200'
                    }`}
                  >
                    <Camera size={12} /> Photo
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdate(
                        [{ ...item, listedOnEbay: !item.listedOnEbay }],
                        undefined,
                        { skipActionLog: true },
                      )
                    }
                    className={`inline-flex items-center px-2 py-1 rounded-lg border text-[10px] font-black uppercase ${
                      item.listedOnEbay
                        ? 'bg-sky-50 text-sky-800 border-sky-200'
                        : 'bg-slate-50 text-slate-400 border-slate-200'
                    }`}
                  >
                    eBay
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdate([{ ...item, reserved: true }], undefined, { skipActionLog: true })
                    }
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 text-[10px] font-black uppercase text-slate-500"
                  >
                    <Bookmark size={12} /> Hold
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(`/panel/inventory?q=${encodeURIComponent(item.name)}`)}
                    className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 text-[10px] font-black uppercase"
                  >
                    <ShoppingBag size={12} /> Open
                  </button>
                </div>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
};

export default SellTodayPage;
