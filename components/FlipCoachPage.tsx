import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Activity,
  Check,
  ClipboardCopy,
  ExternalLink,
  Flame,
  Lightbulb,
  ShoppingBag,
  SkipForward,
  Target,
  TrendingUp,
  Trophy,
  Zap,
} from 'lucide-react';
import type { InventoryItem } from '../types';
import { formatEUR } from '../utils/formatMoney';
import {
  buildSellNowQueue,
  computeBuyFocus,
  listPricesForPocket,
  loadFlipFees,
  maxBuyForEbayFlip,
  maxBuyForKleinFlip,
  saveFlipFees,
  suggestChannelPrices,
  totalEbayFeePct,
  type FlipFeeSettings,
} from '../utils/flipCoach';
import {
  buildDailyMissions,
  channelLabel,
  copyText,
  getMissionProgress,
  getSellScripts,
  loadMissionLog,
  recordMissionAction,
  type MissionLogEntry,
} from '../utils/flipCoachMissions';

interface Props {
  items: InventoryItem[];
}

const FlipCoachPage: React.FC<Props> = ({ items }) => {
  const [fees, setFees] = useState<FlipFeeSettings>(() => loadFlipFees());
  const [lookupName, setLookupName] = useState('');
  const [minProfit, setMinProfit] = useState(30);
  const [missionLog, setMissionLog] = useState<MissionLogEntry[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [scriptOpenId, setScriptOpenId] = useState<string | null>(null);

  const feePct = totalEbayFeePct(fees);

  const buyFocus = useMemo(() => computeBuyFocus(items, 8), [items]);
  const sellNow = useMemo(() => buildSellNowQueue(items, fees, 12), [items, fees]);
  const missions = useMemo(
    () => buildDailyMissions(items, fees, missionLog, 3),
    [items, fees, missionLog]
  );
  const missionProgress = useMemo(() => getMissionProgress(missionLog, 3), [missionLog]);

  useEffect(() => {
    setMissionLog(loadMissionLog());
  }, []);

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

  const flashCopied = (key: string) => {
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1600);
  };

  const onCopyPrice = async (itemId: string, channel: 'klein' | 'ebay', price: number) => {
    const ok = await copyText(String(Math.round(price)));
    if (ok) flashCopied(`${itemId}-${channel}`);
  };

  const onMarkListed = (itemId: string, preferred: string) => {
    setMissionLog(recordMissionAction(itemId, 'listed', preferred));
  };

  const onSkip = (itemId: string) => {
    setMissionLog(recordMissionAction(itemId, 'skipped'));
  };

  return (
    <div className="w-full px-3 sm:px-4 md:px-5 pb-24 md:pb-6 animate-in fade-in space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">Flip Coach</h1>
          <p className="text-xs text-slate-500">
            Sell next · Klein vs eBay prices · what to keep buying
          </p>
        </div>
        <Link
          to="/panel/sold-pulse"
          className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase text-rose-700 hover:text-rose-900 shrink-0"
        >
          <Activity size={13} /> Sold Pulse
        </Link>
      </header>

      {/* Missions: full width, 3 across on desktop */}
      <section className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-3 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-black uppercase tracking-widest text-amber-900 flex items-center gap-1.5">
            <Target size={14} /> Daily Mission
          </h2>
          <div className="flex flex-wrap gap-1.5 text-[10px] font-black uppercase tracking-wide">
            <span className="rounded-md bg-white border border-amber-200 px-2 py-0.5 text-amber-900">
              Today {missionProgress.completedToday}/{missionProgress.targetToday}
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-white border border-amber-200 px-2 py-0.5 text-amber-900">
              <Trophy size={11} /> {missionProgress.weekCompleted}/{missionProgress.weekTarget}
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-white border border-amber-200 px-2 py-0.5 text-amber-900">
              <Flame size={11} /> {missionProgress.streakDays}d
            </span>
          </div>
        </div>

        {missions.length === 0 ? (
          <p className="text-xs text-slate-600">No open missions left for today.</p>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {missions.map((m, idx) => {
              const scripts = getSellScripts(m.preferredChannel);
              const buy = Number(m.item.buyPrice) || 0;
              return (
                <li
                  key={m.missionId}
                  className={`rounded-lg border bg-white p-2.5 space-y-2 min-w-0 ${
                    m.done ? 'border-emerald-200 opacity-75' : 'border-amber-100'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[9px] font-black uppercase tracking-widest text-amber-700">
                        #{idx + 1}
                        {m.action === 'listed' ? ' · listed' : null}
                        {m.action === 'skipped' ? ' · skipped' : null}
                      </p>
                      <p className="text-sm font-black text-slate-900 line-clamp-2">{m.item.name}</p>
                      <p className="text-[10px] text-slate-500 truncate">
                        €{formatEUR(buy)} · {m.daysHeld}d · {channelLabel(m.preferredChannel)}
                      </p>
                    </div>
                    <div className="text-right shrink-0 leading-tight">
                      <p className="text-sm font-black text-emerald-700">
                        K €{formatEUR(m.kleinList)}
                      </p>
                      <p className="text-[11px] font-bold text-blue-700">
                        E €{formatEUR(m.ebayList)}
                      </p>
                    </div>
                  </div>

                  {!m.done ? (
                    <div className="flex flex-wrap gap-1">
                      <Link
                        to={`/panel/edit/${m.item.id}`}
                        className="inline-flex items-center gap-1 rounded-md bg-slate-900 text-white px-2 py-1 text-[10px] font-black uppercase tracking-wide hover:bg-slate-800"
                      >
                        <ExternalLink size={11} /> Open
                      </Link>
                      <button
                        type="button"
                        onClick={() => void onCopyPrice(m.item.id, 'klein', m.kleinList)}
                        className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-900 px-2 py-1 text-[10px] font-black uppercase tracking-wide"
                      >
                        {copiedKey === `${m.item.id}-klein` ? (
                          <Check size={11} />
                        ) : (
                          <ClipboardCopy size={11} />
                        )}
                        Klein
                      </button>
                      <button
                        type="button"
                        onClick={() => void onCopyPrice(m.item.id, 'ebay', m.ebayList)}
                        className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 text-blue-900 px-2 py-1 text-[10px] font-black uppercase tracking-wide"
                      >
                        {copiedKey === `${m.item.id}-ebay` ? (
                          <Check size={11} />
                        ) : (
                          <ClipboardCopy size={11} />
                        )}
                        eBay
                      </button>
                      <button
                        type="button"
                        onClick={() => onMarkListed(m.item.id, m.preferredChannel)}
                        className="inline-flex items-center gap-1 rounded-md bg-amber-500 text-white px-2 py-1 text-[10px] font-black uppercase tracking-wide hover:bg-amber-600"
                      >
                        <Check size={11} /> Listed
                      </button>
                      <button
                        type="button"
                        onClick={() => onSkip(m.item.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 text-slate-600 px-2 py-1 text-[10px] font-bold uppercase tracking-wide"
                      >
                        <SkipForward size={11} /> Skip
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setScriptOpenId((cur) => (cur === m.missionId ? null : m.missionId))
                        }
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 text-slate-600 px-2 py-1 text-[10px] font-bold uppercase tracking-wide"
                      >
                        Scripts
                      </button>
                    </div>
                  ) : null}

                  {scriptOpenId === m.missionId ? (
                    <div className="rounded-md bg-slate-50 border border-slate-100 px-2 py-1.5 space-y-1.5">
                      {scripts.map((s) => (
                        <div key={s.id} className="space-y-0.5">
                          <p className="text-[9px] font-black uppercase text-slate-500">{s.title}</p>
                          <p className="text-[10px] text-slate-700 leading-snug">{s.body}</p>
                          <button
                            type="button"
                            onClick={async () => {
                              const ok = await copyText(s.body);
                              if (ok) flashCopied(`${m.missionId}-${s.id}`);
                            }}
                            className="text-[9px] font-black uppercase text-amber-800 hover:underline"
                          >
                            {copiedKey === `${m.missionId}-${s.id}` ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Bottom: sell queue fills remaining width | tools rail */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,22rem)] xl:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] gap-3 items-start">
        <section className="rounded-xl border border-slate-200 bg-white p-3 space-y-2 min-w-0">
          <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
            <Zap size={13} className="text-amber-500" /> Sell these next
          </h2>
          {sellNow.length === 0 ? (
            <p className="text-xs text-slate-500">No in-stock items to rank yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2 max-h-[min(58vh,34rem)] overflow-y-auto overscroll-contain pr-0.5">
              {sellNow.map((row) => (
                <div
                  key={row.item.id}
                  className="p-2 rounded-lg border border-slate-100 bg-slate-50/80 space-y-1.5 min-w-0"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-black text-slate-900 line-clamp-2">{row.item.name}</p>
                      <p className="text-[10px] text-slate-500">
                        Buy €{formatEUR(row.item.buyPrice || 0)} · {row.daysHeld}d
                        {row.compCount ? ` · ${row.compCount} comps` : ''}
                      </p>
                    </div>
                    <Link
                      to={`/panel/edit/${row.item.id}`}
                      className="shrink-0 inline-flex items-center gap-0.5 text-[9px] font-black uppercase text-blue-700"
                    >
                      Open <ArrowRight size={10} />
                    </Link>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="rounded-md bg-emerald-50 border border-emerald-100 px-2 py-1">
                      <p className="text-[8px] font-black uppercase text-emerald-700">Klein</p>
                      <p className="text-xs font-black text-emerald-900">€{formatEUR(row.kleinList)}</p>
                    </div>
                    <div className="rounded-md bg-blue-50 border border-blue-100 px-2 py-1">
                      <p className="text-[8px] font-black uppercase text-blue-700">eBay</p>
                      <p className="text-xs font-black text-blue-900">€{formatEUR(row.ebayList)}</p>
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-600 flex items-start gap-1">
                    <ShoppingBag size={10} className="mt-0.5 shrink-0 text-slate-400" />
                    <span className="line-clamp-2">
                      <strong>
                        {row.preferredChannel === 'kleinanzeigen.de'
                          ? 'Klein'
                          : row.preferredChannel === 'ebay.de'
                            ? 'eBay'
                            : 'Either'}
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

        <aside className="space-y-3 min-w-0 lg:sticky lg:top-2">
          <section className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
            <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-400">
              eBay cost %
            </h2>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-0.5">
                <span className="text-[9px] font-bold text-slate-400 uppercase">Fee %</span>
                <input
                  type="number"
                  min={0}
                  max={30}
                  step={0.5}
                  value={fees.ebayFeePct}
                  onChange={(e) => updateFees({ ebayFeePct: Number(e.target.value) })}
                  className="w-full px-2 py-1.5 rounded-lg border border-slate-200 bg-slate-50 font-bold text-sm outline-none focus:border-rose-400"
                />
              </label>
              <label className="space-y-0.5">
                <span className="text-[9px] font-bold text-slate-400 uppercase">Ads %</span>
                <input
                  type="number"
                  min={0}
                  max={30}
                  step={0.5}
                  value={fees.ebayAdsPct}
                  onChange={(e) => updateFees({ ebayAdsPct: Number(e.target.value) })}
                  className="w-full px-2 py-1.5 rounded-lg border border-slate-200 bg-slate-50 font-bold text-sm outline-none focus:border-rose-400"
                />
              </label>
              <div className="space-y-0.5">
                <span className="text-[9px] font-bold text-slate-400 uppercase">Total cut</span>
                <p className="px-2 py-1.5 rounded-lg bg-rose-50 border border-rose-100 font-black text-sm text-rose-800">
                  {feePct.toFixed(1)}%
                </p>
              </div>
              <label className="space-y-0.5">
                <span className="text-[9px] font-bold text-slate-400 uppercase">Min profit €</span>
                <input
                  type="number"
                  min={0}
                  step={5}
                  value={minProfit}
                  onChange={(e) => setMinProfit(Number(e.target.value) || 0)}
                  className="w-full px-2 py-1.5 rounded-lg border border-slate-200 bg-slate-50 font-bold text-sm outline-none focus:border-emerald-400"
                />
              </label>
            </div>
            <p className="text-[10px] text-slate-500 leading-snug">
              €100 pocket → Klein €{formatEUR(example.kleinanzeigen)} · eBay €{formatEUR(example.ebay)}
            </p>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
            <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
              <Target size={13} className="text-emerald-600" /> Price idea
            </h2>
            <input
              value={lookupName}
              onChange={(e) => setLookupName(e.target.value)}
              placeholder="e.g. ASUS Dual RTX 3060 12GB"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 font-bold text-sm outline-none focus:border-emerald-400 focus:bg-white"
            />
            {lookup && lookup.compCount > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-slate-500">
                  Comps €{formatEUR(lookup.low)}–€{formatEUR(lookup.high)} · median €
                  {formatEUR(lookup.median)} ({lookup.compCount})
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-2">
                    <p className="text-[9px] font-black uppercase text-emerald-800">Klein</p>
                    <p className="text-lg font-black text-emerald-900">
                      €{formatEUR(lookup.kleinList)}
                    </p>
                    <p className="text-[9px] text-emerald-800/80">
                      max buy €{formatEUR(maxBuyForKleinFlip(lookup.kleinList, minProfit))}
                    </p>
                  </div>
                  <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-2">
                    <p className="text-[9px] font-black uppercase text-blue-800">eBay</p>
                    <p className="text-lg font-black text-blue-900">€{formatEUR(lookup.ebayList)}</p>
                    <p className="text-[9px] text-blue-800/80">
                      max buy €{formatEUR(maxBuyForEbayFlip(lookup.ebayList, feePct, minProfit))}
                    </p>
                  </div>
                </div>
              </div>
            )}
            {lookup && lookup.compCount === 0 && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5">
                {lookup.note}
              </p>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
            <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
              <TrendingUp size={13} className="text-violet-600" /> Keep buying
            </h2>
            {buyFocus.length === 0 ? (
              <p className="text-xs text-slate-500">Need more sold history with dates.</p>
            ) : (
              <div className="space-y-1.5 max-h-[min(32vh,16rem)] overflow-y-auto overscroll-contain">
                {buyFocus.map((row) => (
                  <div
                    key={row.category}
                    className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-50 border border-slate-100"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-black text-slate-900 truncate">{row.category}</p>
                      <p className="text-[10px] text-slate-500">
                        {row.soldCount} sold · ~{row.avgDaysToSell}d · €
                        {formatEUR(row.avgPocketProfit)} · {row.inStock} stock
                      </p>
                    </div>
                    <span
                      className={`shrink-0 text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                        row.advice.startsWith('Buy more') || row.advice.startsWith('Keep')
                          ? 'bg-emerald-100 text-emerald-800'
                          : row.advice.startsWith('Slow')
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {row.advice.split('—')[0].trim()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-3 space-y-1.5">
            <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
              <Lightbulb size={13} className="text-amber-500" /> Quick rules
            </h2>
            <ul className="text-[11px] text-slate-600 space-y-1 leading-snug list-disc pl-4">
              <li>Buy only if max-buy still leaves ≥ €{formatEUR(minProfit)}.</li>
              <li>List same day parts arrive.</li>
              <li>Klein when eBay fees kill margin; eBay for popular models.</li>
              <li>Cut price on stock &gt;45 days.</li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
};

export default FlipCoachPage;
