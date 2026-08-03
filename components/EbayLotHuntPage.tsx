import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Check,
  ClipboardCopy,
  ExternalLink,
  Radar,
  Trash2,
  Upload,
} from 'lucide-react';
import { formatEURPrefix } from '../utils/formatMoney';
import {
  CLAUDE_EBAY_LOT_HUNT_PROMPT,
  CLAUDE_EBAY_LOT_HUNT_STARTER,
  clearEbayLotHuntRuns,
  deleteEbayLotHuntRun,
  exportEbayLotHuntAgentPayload,
  importEbayLotHuntPayload,
  loadEbayLotHuntQuery,
  loadEbayLotHuntRuns,
  saveEbayLotHuntQuery,
  type EbayLotHuntQuery,
  type EbayLotHuntRun,
} from '../utils/ebayLotHunt';

declare global {
  interface Window {
    __EBAY_LOT_HUNT_AGENT__?: unknown;
  }
}

function parseOptionalEuro(raw: string): number | null {
  const t = raw.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

const EbayLotHuntPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const agentMode = searchParams.get('agent') === '1';
  const agentSectionRef = useRef<HTMLElement | null>(null);

  const [query, setQuery] = useState<EbayLotHuntQuery>(() => loadEbayLotHuntQuery());
  const [runs, setRuns] = useState<EbayLotHuntRun[]>(() => loadEbayLotHuntRuns());
  const [paste, setPaste] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'starter' | 'json' | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const agentPayload = useMemo(() => exportEbayLotHuntAgentPayload(query), [query]);
  const agentJsonText = useMemo(() => JSON.stringify(agentPayload, null, 2), [agentPayload]);

  useEffect(() => {
    window.__EBAY_LOT_HUNT_AGENT__ = agentPayload;
  }, [agentPayload]);

  useEffect(() => {
    if (!agentMode) return;
    const t = window.setTimeout(() => {
      agentSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
    return () => window.clearTimeout(t);
  }, [agentMode, query.query]);

  const persistQuery = (next: EbayLotHuntQuery) => {
    setQuery(next);
    saveEbayLotHuntQuery(next);
  };

  const copyText = async (text: string, kind: 'starter' | 'json') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      /* ignore */
    }
  };

  const handleImport = () => {
    setImportError(null);
    try {
      const cleaned = paste.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      const parsed = JSON.parse(cleaned) as {
        query?: Partial<EbayLotHuntQuery>;
        kept?: unknown;
        rejectedCount?: number;
        rejectedSamples?: unknown;
        notes?: string;
      };
      if (!parsed || !Array.isArray(parsed.kept)) {
        throw new Error('JSON must include a kept: [] array');
      }
      const run = importEbayLotHuntPayload(
        {
          query: parsed.query,
          kept: parsed.kept as never,
          rejectedCount: parsed.rejectedCount,
          rejectedSamples: parsed.rejectedSamples as never,
          notes: parsed.notes,
        },
        query,
      );
      setRuns(loadEbayLotHuntRuns());
      setQuery(loadEbayLotHuntQuery());
      setPaste('');
      setToast(`Imported ${run.kept.length} listing${run.kept.length === 1 ? '' : 's'}`);
      window.setTimeout(() => setToast(null), 2800);
    } catch (e) {
      setImportError((e as Error)?.message || 'Invalid JSON');
    }
  };

  const agentUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/panel/ebay-hunt?agent=1`
      : '/panel/ebay-hunt?agent=1';

  return (
    <div className="space-y-5 pb-10 max-w-5xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-900 flex items-center gap-2">
            <Radar size={22} className="text-slate-700" /> eBay Lot Hunt
          </h1>
          <p className="text-[13px] text-slate-500 font-medium mt-0.5">
            Set product + price band → Claude hunts ebay.de once → clean list lands here with links.
          </p>
        </div>
        <Link
          to="/panel/automations?agent=1&job=ebay_hunt"
          className="text-[12px] font-semibold text-slate-600 underline"
        >
          Automations hub
        </Link>
      </header>

      {toast && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] font-semibold text-emerald-900">
          {toast}
        </div>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <h2 className="text-[15px] font-semibold tracking-tight">Hunt query</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="sm:col-span-2 space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Product name</span>
            <input
              value={query.query}
              onChange={(e) => persistQuery({ ...query, query: e.target.value })}
              placeholder="e.g. RTX 3070 8GB"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-[14px] font-medium"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Min €</span>
            <input
              value={query.priceMin ?? ''}
              onChange={(e) => persistQuery({ ...query, priceMin: parseOptionalEuro(e.target.value) })}
              placeholder="40"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-[14px] font-medium tabular-nums"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Max €</span>
            <input
              value={query.priceMax ?? ''}
              onChange={(e) => persistQuery({ ...query, priceMax: parseOptionalEuro(e.target.value) })}
              placeholder="120"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-[14px] font-medium tabular-nums"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Keep max</span>
            <input
              type="number"
              min={3}
              max={40}
              value={query.maxKeep}
              onChange={(e) =>
                persistQuery({ ...query, maxKeep: Math.max(3, Math.min(40, Number(e.target.value) || 12)) })
              }
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-[14px] font-medium tabular-nums"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Listing type</span>
            <select
              value={query.listingType}
              onChange={(e) =>
                persistQuery({
                  ...query,
                  listingType: e.target.value as EbayLotHuntQuery['listingType'],
                })
              }
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-[14px] font-medium"
            >
              <option value="all">All</option>
              <option value="bin">Buy It Now</option>
              <option value="auction">Auction</option>
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <a
            href={agentPayload.searchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-[12px] font-semibold text-slate-700"
          >
            <ExternalLink size={13} /> Open eBay search
          </a>
          <button
            type="button"
            onClick={() => copyText(CLAUDE_EBAY_LOT_HUNT_STARTER, 'starter')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 text-white text-[12px] font-semibold"
          >
            <ClipboardCopy size={13} />
            {copied === 'starter' ? 'Copied' : 'Copy Claude starter'}
          </button>
        </div>
        {!query.query.trim() && (
          <p className="text-[12px] text-amber-800 font-medium">Enter a product name before arming Claude.</p>
        )}
      </section>

      <section
        ref={agentSectionRef}
        id="ebay-hunt-agent"
        data-ebay-hunt-ready={query.query.trim() ? 'true' : 'false'}
        className={`rounded-2xl border p-4 space-y-3 ${
          agentMode ? 'border-slate-900 bg-slate-50' : 'border-slate-200 bg-white'
        }`}
      >
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">Agent brief</h2>
          <p className="text-[12px] text-slate-500 font-medium mt-0.5">
            Tell Claude: open this page and run. One hunt per run — no buying.
          </p>
          <p className="text-[11px] font-mono text-slate-400 mt-1 break-all">{agentUrl}</p>
        </div>
        <pre
          id="ebay-hunt-agent-brief"
          className="whitespace-pre-wrap text-[11px] leading-snug font-mono text-slate-700 bg-white border border-slate-200 rounded-xl p-3 max-h-56 overflow-y-auto"
        >
          {CLAUDE_EBAY_LOT_HUNT_PROMPT}
        </pre>
        <div>
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <p className="text-[12px] font-semibold text-slate-700">Hunt config JSON</p>
            <button
              type="button"
              onClick={() => copyText(agentJsonText, 'json')}
              className="text-[11px] font-semibold text-slate-500 hover:text-slate-800"
            >
              {copied === 'json' ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre
            id="ebay-hunt-agent-json"
            className="whitespace-pre text-[10px] leading-snug font-mono bg-slate-900 text-slate-100 rounded-xl p-3 max-h-48 overflow-auto"
          >
            {agentJsonText}
          </pre>
        </div>

        <div className="space-y-2">
          <p className="text-[12px] font-semibold text-slate-700 flex items-center gap-1.5">
            <Upload size={14} /> Paste Claude results → Import
          </p>
          <textarea
            id="ebay-hunt-results-paste"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={8}
            placeholder='{"kept":[{"title":"...","price":49,"url":"https://www.ebay.de/itm/...","keptReason":"..."}],"rejectedCount":10}'
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-mono"
          />
          {importError && <p className="text-[12px] text-rose-700 font-medium">{importError}</p>}
          <button
            type="button"
            id="ebay-hunt-import-btn"
            onClick={handleImport}
            disabled={!paste.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-700 text-white text-[12px] font-semibold disabled:opacity-40"
          >
            <Check size={13} /> Import results
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold tracking-tight">Saved hunts</h2>
          {runs.length > 0 && (
            <button
              type="button"
              onClick={() => {
                clearEbayLotHuntRuns();
                setRuns([]);
              }}
              className="text-[11px] font-semibold text-slate-500 hover:text-rose-700"
            >
              Clear all
            </button>
          )}
        </div>

        {runs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-[13px] text-slate-500">
            No hunts yet. Set a query, send Claude here, then Import results.
          </div>
        ) : (
          runs.map((run) => (
            <article key={run.id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[14px] font-semibold text-slate-900">{run.query.query || '—'}</p>
                  <p className="text-[11px] text-slate-500 font-medium">
                    {new Date(run.createdAt).toLocaleString()} · keep {run.kept.length}
                    {run.query.priceMin != null || run.query.priceMax != null
                      ? ` · €${run.query.priceMin ?? '…'}–${run.query.priceMax ?? '…'}`
                      : ''}
                    {run.rejectedCount ? ` · rejected ~${run.rejectedCount}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    deleteEbayLotHuntRun(run.id);
                    setRuns(loadEbayLotHuntRuns());
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-rose-700"
                >
                  <Trash2 size={12} /> Delete
                </button>
              </div>
              {run.notes ? (
                <p className="px-4 py-2 text-[12px] text-slate-600 border-b border-slate-50">{run.notes}</p>
              ) : null}
              <ul className="divide-y divide-slate-100">
                {run.kept.map((hit) => (
                  <li key={`${run.id}_${hit.itemId}`} className="px-4 py-3 flex flex-wrap items-start gap-3">
                    {hit.thumbnailUrl ? (
                      <img
                        src={hit.thumbnailUrl}
                        alt=""
                        className="w-14 h-14 rounded-lg object-cover border border-slate-100 bg-slate-50"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-lg bg-slate-50 border border-slate-100" />
                    )}
                    <div className="min-w-0 flex-1">
                      <a
                        href={hit.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[13px] font-semibold text-slate-900 hover:underline"
                      >
                        {hit.title}
                      </a>
                      <p className="text-[12px] text-slate-600 mt-0.5 tabular-nums">
                        {formatEURPrefix(hit.price)}
                        {hit.shipping != null ? ` + ship ${formatEURPrefix(hit.shipping)}` : ''}
                        {hit.condition ? ` · ${hit.condition}` : ''}
                        {hit.seller ? ` · ${hit.seller}` : ''}
                      </p>
                      <p className="text-[11px] text-emerald-800 mt-0.5">{hit.keptReason}</p>
                    </div>
                    <a
                      href={hit.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 shrink-0"
                    >
                      <ExternalLink size={12} /> eBay
                    </a>
                  </li>
                ))}
              </ul>
              {run.rejectedSamples.length > 0 && (
                <details className="px-4 py-2 border-t border-slate-100 bg-slate-50/60">
                  <summary className="text-[11px] font-semibold text-slate-500 cursor-pointer">
                    Rejected samples ({run.rejectedSamples.length})
                  </summary>
                  <ul className="mt-2 space-y-1 pb-2">
                    {run.rejectedSamples.map((r, i) => (
                      <li key={i} className="text-[11px] text-slate-600">
                        <span className="font-medium">{r.title}</span>
                        {r.price != null ? ` · ${formatEURPrefix(r.price)}` : ''} — {r.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </article>
          ))
        )}
      </section>
    </div>
  );
};

export default EbayLotHuntPage;
