import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Check,
  ClipboardCopy,
  Download,
  RefreshCw,
  TrendingDown,
} from 'lucide-react';
import type { InventoryItem } from '../types';
import { formatEURPrefix } from '../utils/formatMoney';
import { loadFlipFees } from '../utils/flipCoach';
import {
  buildPriceDropPlan,
  CLAUDE_PRICE_DROP_PROMPT,
  CLAUDE_PRICE_DROP_STARTER,
  exportAgentPayload,
  isPlanDue,
  loadPriceDropPlan,
  markRowsApplied,
  savePriceDropPlan,
  type MatchConfidence,
  type PriceDropChannel,
  type PriceDropPlan,
  type PriceDropRow,
  type PriceDropRowStatus,
} from '../utils/priceDropSchedule';

type Props = { items: InventoryItem[] };

type FilterId = 'all' | 'ready' | 'at_floor' | 'unmatched' | 'applied' | 'ebay' | 'kleinanzeigen';

declare global {
  interface Window {
    __PRICE_DROP_AGENT__?: unknown;
  }
}

function formatDue(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

function statusLabel(s: PriceDropRowStatus): string {
  if (s === 'ready') return 'Ready';
  if (s === 'at_floor') return 'Floor';
  if (s === 'applied') return 'Applied';
  return 'Skip';
}

function confTone(c: MatchConfidence): string {
  if (c === 'high') return 'text-emerald-700 bg-emerald-50';
  if (c === 'medium') return 'text-amber-800 bg-amber-50';
  return 'text-slate-500 bg-slate-100';
}

const PriceDropPage: React.FC<Props> = ({ items }) => {
  const [searchParams] = useSearchParams();
  const agentMode = searchParams.get('agent') === '1';
  const agentSectionRef = useRef<HTMLElement | null>(null);

  const [plan, setPlan] = useState<PriceDropPlan | null>(() => loadPriceDropPlan());
  const [filter, setFilter] = useState<FilterId>('all');
  const [copied, setCopied] = useState<'starter' | 'json' | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const fees = useMemo(() => loadFlipFees(), []);

  const refresh = (force = false) => {
    const prev = loadPriceDropPlan();
    if (!force && prev && !isPlanDue(prev)) {
      setPlan(prev);
      return;
    }
    const next = buildPriceDropPlan(items, fees, { previous: prev });
    savePriceDropPlan(next);
    setPlan(next);
    setSelected(new Set());
  };

  useEffect(() => {
    const prev = loadPriceDropPlan();
    if (!prev || isPlanDue(prev)) {
      refresh(true);
    } else {
      setPlan(prev);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  useEffect(() => {
    if (!agentMode) return;
    const t = window.setTimeout(() => {
      agentSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
    return () => window.clearTimeout(t);
  }, [agentMode, plan?.generatedAt]);

  const rows = plan?.rows ?? [];
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filter === 'all') return true;
      if (filter === 'ebay' || filter === 'kleinanzeigen') return r.channel === filter;
      return r.status === filter;
    });
  }, [rows, filter]);

  const counts = useMemo(() => {
    const c = { ready: 0, at_floor: 0, unmatched: 0, applied: 0, ebay: 0, kleinanzeigen: 0 };
    for (const r of rows) {
      c[r.status] += 1;
      c[r.channel] += 1;
    }
    return c;
  }, [rows]);

  const agentPayload = useMemo(() => (plan ? exportAgentPayload(plan) : null), [plan]);
  const agentJsonText = useMemo(
    () => (agentPayload ? JSON.stringify(agentPayload, null, 2) : '{"rows":[]}'),
    [agentPayload],
  );

  useEffect(() => {
    window.__PRICE_DROP_AGENT__ = agentPayload ?? { rows: [] };
    return () => {
      delete window.__PRICE_DROP_AGENT__;
    };
  }, [agentPayload]);

  const rowKey = (r: PriceDropRow) => `${r.itemId}:${r.channel}`;

  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const markSelectedApplied = () => {
    if (!plan || !selected.size) return;
    const keys = [...selected].map((k) => {
      const [itemId, channel] = k.split(':') as [string, PriceDropChannel];
      return { itemId, channel };
    });
    const next = markRowsApplied(plan, keys);
    savePriceDropPlan(next);
    setPlan(next);
    setSelected(new Set());
  };

  const markAllReadyApplied = () => {
    if (!plan) return;
    const keys = plan.rows
      .filter((r) => r.status === 'ready')
      .map((r) => ({ itemId: r.itemId, channel: r.channel }));
    if (!keys.length) return;
    const next = markRowsApplied(plan, keys);
    savePriceDropPlan(next);
    setPlan(next);
    setSelected(new Set());
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

  const downloadJson = () => {
    if (!agentPayload) return;
    const blob = new Blob([agentJsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `price-drop-plan-${plan?.generatedAt?.slice(0, 10) ?? 'export'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const due = plan ? isPlanDue(plan) : true;
  const agentUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/panel/price-drop?agent=1`
      : '/panel/price-drop?agent=1';

  return (
    <div className="space-y-5 pb-10 max-w-6xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-900 flex items-center gap-2">
            <TrendingDown size={22} className="text-slate-700" /> Price Drop
          </h1>
          <p className="text-[13px] text-slate-500 font-medium mt-0.5">
            Claude reads this page himself · −5% / 3d · floor buy×1.30 · max 8% / edit
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            id="price-drop-refresh"
            onClick={() => refresh(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 text-white text-[12px] font-semibold"
          >
            <RefreshCw size={14} /> Refresh plan
          </button>
        </div>
      </header>

      {/* Machine-readable brief for Claude Chrome — always in the DOM */}
      <section
        ref={agentSectionRef}
        id="price-drop-agent"
        data-price-drop-ready={agentPayload && agentPayload.rows.length > 0 ? 'true' : 'false'}
        data-price-drop-due={due ? 'true' : 'false'}
        className={`rounded-2xl border p-4 space-y-3 ${
          agentMode ? 'border-slate-900 bg-slate-50' : 'border-slate-200 bg-white'
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight">Agent brief</h2>
            <p className="text-[12px] text-slate-500 font-medium mt-0.5">
              Claude opens this URL, reads the brief + JSON below, then edits eBay/KA. No paste needed.
            </p>
            <p className="text-[11px] font-mono text-slate-400 mt-1 break-all">{agentUrl}</p>
          </div>
          <button
            type="button"
            onClick={() => copyText(CLAUDE_PRICE_DROP_STARTER, 'starter')}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-[11px] font-semibold text-slate-600"
            title="Only for a brand-new Claude chat — after that he uses this page"
          >
            <ClipboardCopy size={13} />
            {copied === 'starter' ? 'Copied' : 'Copy 1-line starter'}
          </button>
        </div>

        <pre
          id="price-drop-agent-brief"
          className="whitespace-pre-wrap text-[11px] leading-snug font-mono text-slate-700 bg-white border border-slate-200 rounded-xl p-3 max-h-56 overflow-y-auto"
        >
          {CLAUDE_PRICE_DROP_PROMPT}
        </pre>

        <div>
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <p className="text-[12px] font-semibold text-slate-700">
              Today&apos;s plan JSON{' '}
              <span className="font-medium text-slate-400">
                · {agentPayload?.rows.length ?? 0} rows to apply
              </span>
            </p>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => copyText(agentJsonText, 'json')}
                className="text-[11px] font-semibold text-slate-500 hover:text-slate-800"
              >
                {copied === 'json' ? 'Copied' : 'Copy'}
              </button>
              <button
                type="button"
                onClick={downloadJson}
                className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 inline-flex items-center gap-0.5"
              >
                <Download size={12} /> File
              </button>
            </div>
          </div>
          <pre
            id="price-drop-agent-json"
            data-testid="price-drop-agent-json"
            className="whitespace-pre text-[10px] leading-snug font-mono text-slate-800 bg-slate-900 text-slate-100 rounded-xl p-3 max-h-72 overflow-auto"
          >
            {agentJsonText}
          </pre>
        </div>
      </section>

      {plan && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
            <p className="text-[11px] font-medium text-slate-400">Generated</p>
            <p className="text-[13px] font-semibold mt-1">{formatDue(plan.generatedAt)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
            <p className="text-[11px] font-medium text-slate-400">Next run</p>
            <p className={`text-[13px] font-semibold mt-1 ${due ? 'text-amber-700' : ''}`}>
              {formatDue(plan.nextDueAt)}
              {due ? ' · due' : ''}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
            <p className="text-[11px] font-medium text-slate-400">Ready</p>
            <p className="text-[20px] font-semibold tabular-nums tracking-tight mt-0.5">{counts.ready}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
            <p className="text-[11px] font-medium text-slate-400">Agent rows</p>
            <p className="text-[20px] font-semibold tabular-nums tracking-tight mt-0.5">
              {agentPayload?.rows.length ?? 0}
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          id="price-drop-mark-all-applied"
          onClick={markAllReadyApplied}
          disabled={!counts.ready}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-700 text-white text-[12px] font-semibold disabled:opacity-40"
        >
          <Check size={14} /> Mark all ready applied
        </button>
        <button
          type="button"
          onClick={markSelectedApplied}
          disabled={!selected.size}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-[12px] font-semibold text-slate-700 disabled:opacity-40"
        >
          Mark selected applied
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ['all', `All (${rows.length})`],
            ['ready', `Ready (${counts.ready})`],
            ['at_floor', `Floor (${counts.at_floor})`],
            ['unmatched', `Skip (${counts.unmatched})`],
            ['applied', `Applied (${counts.applied})`],
            ['ebay', `eBay (${counts.ebay})`],
            ['kleinanzeigen', `KA (${counts.kleinanzeigen})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
              filter === id
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-600 border-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {!rows.length ? (
        <p className="text-[13px] text-slate-500 font-medium p-8 text-center rounded-2xl border border-dashed border-slate-200">
          No listed IN_STOCK items with eBay/KA signals. Sync listing presence first, then Refresh.
        </p>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2.5 w-8" />
                  <th className="px-3 py-2.5">Item</th>
                  <th className="px-3 py-2.5">Channel</th>
                  <th className="px-3 py-2.5">Match</th>
                  <th className="px-3 py-2.5 text-right">Live</th>
                  <th className="px-3 py-2.5 text-right">Next</th>
                  <th className="px-3 py-2.5 text-right">Floor</th>
                  <th className="px-3 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((r) => {
                  const key = rowKey(r);
                  const dropAmt =
                    r.currentPrice != null && r.nextPrice != null
                      ? r.currentPrice - r.nextPrice
                      : 0;
                  return (
                    <tr key={key} className="hover:bg-slate-50/80">
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={selected.has(key)}
                          onChange={() => toggleSelect(key)}
                          disabled={r.status === 'unmatched'}
                          aria-label={`Select ${r.inventoryName}`}
                        />
                      </td>
                      <td className="px-3 py-2.5 max-w-[14rem]">
                        <p className="font-semibold text-slate-900 truncate" title={r.inventoryName}>
                          {r.inventoryName}
                        </p>
                        <p className="text-[10px] text-slate-400 tabular-nums">
                          buy {formatEURPrefix(r.buyPrice)}
                          {r.listingIdOrUrl ? ` · ${r.listingIdOrUrl.slice(0, 28)}` : ''}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 font-medium text-slate-700">
                        {r.channel === 'ebay' ? 'eBay' : 'KA'}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-flex px-1.5 py-0.5 rounded-md text-[10px] font-semibold ${confTone(r.matchConfidence)}`}
                        >
                          {r.matchConfidence}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                        {r.currentPrice != null ? formatEURPrefix(r.currentPrice) : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-900">
                        {r.nextPrice != null ? formatEURPrefix(r.nextPrice) : '—'}
                        {dropAmt > 0 && (
                          <span className="block text-[10px] font-medium text-emerald-700">
                            −{formatEURPrefix(dropAmt)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">
                        {formatEURPrefix(r.floorPrice)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-[11px] font-semibold text-slate-600">
                          {statusLabel(r.status)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default PriceDropPage;
