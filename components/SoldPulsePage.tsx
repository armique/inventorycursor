import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Check,
  CircleHelp,
  ExternalLink,
  Loader2,
  Plus,
  Sparkles,
  Target,
  Trash2,
  Activity,
} from 'lucide-react';
import type { InventoryItem } from '../types';
import { formatEUR } from '../utils/formatMoney';
import { computeBuyFocus } from '../utils/flipCoach';
import {
  buildEbaySoldUrl,
  daysSince,
  markSoldPulseChecked,
  removeSoldPulseItem,
  seedSoldPulsePresetsIfEmpty,
  sortWatchlistForCheck,
  upsertSoldPulseItem,
  type SoldPulseCategory,
  type SoldPulseWatchItem,
} from '../utils/ebaySoldPulse';
import { canUseSoldPulseAi, summarizePastedSoldComps } from '../services/soldPulseAI';

interface Props {
  items: InventoryItem[];
}

const CATEGORIES: SoldPulseCategory[] = [
  'GPU',
  'CPU',
  'RAM',
  'SSD',
  'Motherboard',
  'PSU',
  'Cooler',
  'Case',
  'Other',
];

/**
 * Monitor what’s selling on eBay.de for PC parts — real sold links + your notes.
 * AI only helps summarize prices you paste (never invents sold comps).
 */
const SoldPulsePage: React.FC<Props> = ({ items }) => {
  const [watchlist, setWatchlist] = useState<SoldPulseWatchItem[]>(() => seedSoldPulsePresetsIfEmpty());
  const [newQuery, setNewQuery] = useState('');
  const [newCategory, setNewCategory] = useState<SoldPulseCategory>('GPU');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [paste, setPaste] = useState('');
  const [low, setLow] = useState('');
  const [median, setMedian] = useState('');
  const [high, setHigh] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterCat, setFilterCat] = useState<SoldPulseCategory | 'ALL'>('ALL');

  const buyFocus = useMemo(() => computeBuyFocus(items, 6), [items]);
  const aiOk = canUseSoldPulseAi();

  const sorted = useMemo(() => {
    const base = sortWatchlistForCheck(watchlist);
    if (filterCat === 'ALL') return base;
    return base.filter((x) => x.category === filterCat);
  }, [watchlist, filterCat]);

  const active = watchlist.find((x) => x.id === activeId) || null;

  const openItem = (item: SoldPulseWatchItem) => {
    setActiveId(item.id);
    setPaste('');
    setLow(item.low != null ? String(item.low) : '');
    setMedian(item.median != null ? String(item.median) : '');
    setHigh(item.high != null ? String(item.high) : '');
    setNote(item.note || '');
    setMessage(null);
    setError(null);
  };

  const addItem = () => {
    const q = newQuery.trim();
    if (!q) return;
    const next = upsertSoldPulseItem(watchlist, { query: q, category: newCategory });
    setWatchlist(next);
    setNewQuery('');
    const created = next.find((x) => x.query.toLowerCase() === q.toLowerCase());
    if (created) openItem(created);
  };

  const savePrices = (id: string) => {
    const parse = (s: string) => {
      const n = Number(String(s).replace(',', '.'));
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    const next = markSoldPulseChecked(watchlist, id, {
      low: parse(low),
      median: parse(median),
      high: parse(high),
      note: note.trim() || undefined,
    });
    setWatchlist(next);
    setMessage('Saved. Marked as checked just now.');
  };

  const runAiOnPaste = async () => {
    if (!active) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const summary = await summarizePastedSoldComps(active.query, paste);
      setLow(String(summary.low));
      setMedian(String(summary.median));
      setHigh(String(summary.high));
      const warn = summary.warnings.length ? ` ⚠ ${summary.warnings.join(' · ')}` : '';
      setMessage(
        `${summary.usedAi ? 'AI filtered your paste' : 'Local math from paste'}: median €${formatEUR(summary.median)} (${summary.count} prices). ${summary.advice}${warn}`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read paste');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-5 pb-24 md:pb-10 animate-in fade-in">
      <header className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight flex items-center gap-2">
          <Activity size={26} className="text-rose-600" /> eBay Sold Pulse
        </h1>
        <p className="text-sm text-slate-600 max-w-2xl leading-relaxed">
          Watch what PC parts are really selling for on eBay.de. You open filtered sold links, then save the
          prices you trust. AI can help clean a paste — it does <strong>not</strong> invent sold prices.
        </p>
        <div className="flex flex-wrap gap-2 text-xs">
          <Link
            to="/panel/flip-coach"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 text-white font-bold"
          >
            <Target size={12} /> Flip Coach (your fees)
          </Link>
        </div>
      </header>

      <section className="rounded-2xl border border-sky-100 bg-sky-50/60 p-4 space-y-2">
        <h2 className="text-sm font-black uppercase tracking-widest text-sky-900 flex items-center gap-2">
          <CircleHelp size={16} /> How to use (2 minutes)
        </h2>
        <ol className="text-sm text-slate-700 space-y-1 list-decimal pl-5 leading-relaxed">
          <li>Tap a part → open <strong>Used + Buy It Now</strong> sold link.</li>
          <li>Ignore Defekt, wrong models, crazy cheap auctions.</li>
          <li>Type low / median / high (or paste sold rows and let AI/local math help).</li>
          <li>Save → next week you see what’s stale to re-check.</li>
        </ol>
      </section>

      {/* Add */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <h2 className="text-xs font-black uppercase tracking-widest text-slate-400">Add to watchlist</h2>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={newQuery}
            onChange={(e) => setNewQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addItem()}
            placeholder="e.g. RTX 3060 Ti"
            className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 font-bold text-sm outline-none focus:border-rose-400"
          />
          <select
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value as SoldPulseCategory)}
            className="px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 font-bold text-sm"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={addItem}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-rose-600 text-white text-xs font-black uppercase"
          >
            <Plus size={14} /> Add
          </button>
        </div>
      </section>

      {/* Your flip categories */}
      {buyFocus.length > 0 && (
        <section className="rounded-2xl border border-violet-100 bg-violet-50/40 p-4 space-y-2">
          <h2 className="text-xs font-black uppercase tracking-widest text-violet-800">
            From your sales — worth watching
          </h2>
          <div className="flex flex-wrap gap-2">
            {buyFocus.map((row) => (
              <button
                key={row.category}
                type="button"
                onClick={() => {
                  setNewQuery(row.category);
                  setNewCategory(
                    (CATEGORIES.includes(row.category as SoldPulseCategory)
                      ? row.category
                      : 'Other') as SoldPulseCategory
                  );
                }}
                className="px-2.5 py-1.5 rounded-lg bg-white border border-violet-100 text-[11px] font-bold text-violet-900"
                title={`Avg profit €${formatEUR(row.avgPocketProfit)} · ~${row.avgDaysToSell}d`}
              >
                {row.category} · €{formatEUR(row.avgPocketProfit)} · {row.avgDaysToSell}d
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Filter */}
      <div className="flex flex-wrap gap-1.5">
        {(['ALL', ...CATEGORIES] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setFilterCat(c)}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase ${
              filterCat === c ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-5 gap-4">
        {/* List */}
        <div className="lg:col-span-2 space-y-2">
          {sorted.map((item) => {
            const age = daysSince(item.lastCheckedAt);
            const selected = item.id === activeId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => openItem(item)}
                className={`w-full text-left p-3 rounded-xl border transition-all ${
                  selected
                    ? 'border-rose-300 bg-rose-50/50 shadow-sm'
                    : 'border-slate-100 bg-white hover:border-slate-200'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-900 truncate">{item.query}</p>
                    <p className="text-[10px] font-bold uppercase text-slate-400 mt-0.5">
                      {item.category}
                      {age == null ? ' · never checked' : age === 0 ? ' · checked today' : ` · ${age}d ago`}
                    </p>
                  </div>
                  {item.median != null && (
                    <span className="shrink-0 text-xs font-black text-emerald-700">
                      €{formatEUR(item.median)}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
          {sorted.length === 0 && (
            <p className="text-sm text-slate-500 p-4">No items in this filter. Add a PC part above.</p>
          )}
        </div>

        {/* Detail */}
        <div className="lg:col-span-3 rounded-2xl border border-slate-200 bg-white p-4 space-y-4 min-h-[20rem]">
          {!active ? (
            <p className="text-sm text-slate-500">Pick a part on the left to open sold links and save prices.</p>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-lg font-black text-slate-900">{active.query}</h3>
                  <p className="text-xs text-slate-500">{active.category}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setWatchlist(removeSoldPulseItem(watchlist, active.id));
                    setActiveId(null);
                  }}
                  className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                  title="Remove from watchlist"
                >
                  <Trash2 size={16} />
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                <a
                  href={buildEbaySoldUrl(active.query, 'used_bin')}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase"
                >
                  <ExternalLink size={12} /> Used + Buy It Now
                </a>
                <a
                  href={buildEbaySoldUrl(active.query, 'used_all')}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-slate-700 text-[10px] font-black uppercase"
                >
                  Used (incl. auctions)
                </a>
                <a
                  href={buildEbaySoldUrl(active.query, 'for_parts')}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-[10px] font-black uppercase"
                >
                  For parts / Defekt
                </a>
              </div>
              <p className="text-[11px] text-slate-500">
                Prefer <strong>Used + Buy It Now</strong> for normal working parts. Use Defekt link only if you
                flip broken gear.
              </p>

              <div className="grid grid-cols-3 gap-2">
                <label className="space-y-1">
                  <span className="text-[9px] font-black uppercase text-slate-400">Low €</span>
                  <input
                    value={low}
                    onChange={(e) => setLow(e.target.value)}
                    inputMode="decimal"
                    className="w-full px-2.5 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm font-bold outline-none"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[9px] font-black uppercase text-slate-400">Median €</span>
                  <input
                    value={median}
                    onChange={(e) => setMedian(e.target.value)}
                    inputMode="decimal"
                    className="w-full px-2.5 py-2 rounded-xl border border-emerald-200 bg-emerald-50/50 text-sm font-bold outline-none"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[9px] font-black uppercase text-slate-400">High €</span>
                  <input
                    value={high}
                    onChange={(e) => setHigh(e.target.value)}
                    inputMode="decimal"
                    className="w-full px-2.5 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm font-bold outline-none"
                  />
                </label>
              </div>

              <label className="block space-y-1">
                <span className="text-[9px] font-black uppercase text-slate-400">Note</span>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. ignore 8GB versions / lots"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm font-medium outline-none"
                />
              </label>

              <div className="space-y-2">
                <label className="block space-y-1">
                  <span className="text-[9px] font-black uppercase text-slate-400">
                    Optional: paste sold rows from eBay
                  </span>
                  <textarea
                    value={paste}
                    onChange={(e) => setPaste(e.target.value)}
                    rows={4}
                    placeholder="Paste a few sold titles + prices here…"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-medium outline-none resize-y"
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || !paste.trim()}
                  onClick={() => void runAiOnPaste()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-violet-200 bg-violet-50 text-violet-800 text-[10px] font-black uppercase disabled:opacity-50"
                >
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  {aiOk ? 'Read paste (AI + local)' : 'Read paste (local only)'}
                </button>
              </div>

              {message && (
                <p className="text-[11px] font-medium text-emerald-900 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2">
                  {message}
                </p>
              )}
              {error && (
                <p className="text-[11px] font-bold text-amber-900 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                  {error}
                </p>
              )}

              <button
                type="button"
                onClick={() => savePrices(active.id)}
                className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-600 text-white text-xs font-black uppercase"
              >
                <Check size={14} /> Save prices + mark checked
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SoldPulsePage;
