import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Check,
  ClipboardCopy,
  Download,
  RefreshCw,
  Upload,
} from 'lucide-react';
import type { InventoryItem } from '../types';
import { formatEURPrefix } from '../utils/formatMoney';
import { loadFlipFees } from '../utils/flipCoach';
import {
  buildListReadyPlan,
  CLAUDE_LIST_READY_PROMPT,
  CLAUDE_LIST_READY_STARTER,
  exportListReadyAgentPayload,
  markListReadyDraft,
  markListReadyMany,
  type ListReadyDraftStatus,
  type ListReadyPlan,
  type ListReadyRow,
} from '../utils/listReadyQueue';

type Props = { items: InventoryItem[] };

type FilterId = 'all' | 'queued' | 'blocked' | 'drafted' | 'done';

declare global {
  interface Window {
    __LIST_READY_AGENT__?: unknown;
  }
}

function statusLabel(s: ListReadyDraftStatus): string {
  if (s === 'queued') return 'Queued';
  if (s === 'blocked') return 'Blocked';
  if (s === 'drafted_ka') return 'Draft KA';
  if (s === 'drafted_ebay') return 'Draft eBay';
  if (s === 'drafted_both') return 'Drafts both';
  if (s === 'already_listed') return 'Listed';
  return 'Skipped';
}

const ListReadyPage: React.FC<Props> = ({ items }) => {
  const [searchParams] = useSearchParams();
  const agentMode = searchParams.get('agent') === '1';
  const agentSectionRef = useRef<HTMLElement | null>(null);
  const [plan, setPlan] = useState<ListReadyPlan | null>(null);
  const [filter, setFilter] = useState<FilterId>('all');
  const [copied, setCopied] = useState<'starter' | 'json' | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const fees = useMemo(() => loadFlipFees(), []);

  const rebuild = () => {
    const next = buildListReadyPlan(items, fees);
    setPlan(next);
    setSelected(new Set());
  };

  useEffect(() => {
    rebuild();
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
      if (filter === 'queued') return r.status === 'queued';
      if (filter === 'blocked') return r.status === 'blocked';
      if (filter === 'drafted') {
        return r.status === 'drafted_ka' || r.status === 'drafted_ebay' || r.status === 'drafted_both';
      }
      return r.status === 'already_listed' || r.status === 'skipped';
    });
  }, [rows, filter]);

  const counts = useMemo(() => {
    const c = { queued: 0, blocked: 0, drafted: 0, done: 0 };
    for (const r of rows) {
      if (r.status === 'queued') c.queued += 1;
      else if (r.status === 'blocked') c.blocked += 1;
      else if (r.status === 'drafted_ka' || r.status === 'drafted_ebay' || r.status === 'drafted_both') {
        c.drafted += 1;
      } else c.done += 1;
    }
    return c;
  }, [rows]);

  const agentPayload = useMemo(() => (plan ? exportListReadyAgentPayload(plan) : null), [plan]);
  const agentJsonText = useMemo(
    () => (agentPayload ? JSON.stringify(agentPayload, null, 2) : '{"mode":"drafts_only","rows":[]}'),
    [agentPayload],
  );

  useEffect(() => {
    window.__LIST_READY_AGENT__ = agentPayload ?? { rows: [] };
    return () => {
      delete window.__LIST_READY_AGENT__;
    };
  }, [agentPayload]);

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
    const blob = new Blob([agentJsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `list-ready-drafts-${plan?.generatedAt?.slice(0, 10) ?? 'export'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const markSelected = (status: ListReadyDraftStatus) => {
    if (!selected.size) return;
    markListReadyMany([...selected], status);
    rebuild();
  };

  const markRow = (row: ListReadyRow, status: ListReadyDraftStatus) => {
    markListReadyDraft(row.itemId, { status });
    rebuild();
  };

  const agentUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/panel/list-ready?agent=1`
      : '/panel/list-ready?agent=1';

  return (
    <div className="space-y-5 pb-10 max-w-6xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-900 flex items-center gap-2">
            <Upload size={22} className="text-slate-700" /> List Ready
          </h1>
          <p className="text-[13px] text-slate-500 font-medium mt-0.5">
            saleReady → Claude creates <span className="text-slate-800">drafts only</span> on KA + eBay ·
            you publish after review
          </p>
        </div>
        <button
          type="button"
          id="list-ready-refresh"
          onClick={rebuild}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 text-white text-[12px] font-semibold"
        >
          <RefreshCw size={14} /> Rebuild queue
        </button>
      </header>

      <section
        ref={agentSectionRef}
        id="list-ready-agent"
        data-list-ready-ready={agentPayload && agentPayload.rows.length > 0 ? 'true' : 'false'}
        data-list-ready-syncing="false"
        className={`rounded-2xl border p-4 space-y-3 ${
          agentMode ? 'border-slate-900 bg-slate-50' : 'border-slate-200 bg-white'
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight">Agent brief</h2>
            <p className="text-[12px] text-slate-500 font-medium mt-0.5">
              Claude reads this page → creates drafts → never publishes. You confirm eBay live later.
            </p>
            <p className="text-[11px] font-mono text-slate-400 mt-1 break-all">{agentUrl}</p>
          </div>
          <button
            type="button"
            onClick={() => copyText(CLAUDE_LIST_READY_STARTER, 'starter')}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-[11px] font-semibold text-slate-600"
          >
            <ClipboardCopy size={13} />
            {copied === 'starter' ? 'Copied' : 'Copy 1-line starter'}
          </button>
        </div>

        <pre
          id="list-ready-agent-brief"
          className="whitespace-pre-wrap text-[11px] leading-snug font-mono text-slate-700 bg-white border border-slate-200 rounded-xl p-3 max-h-56 overflow-y-auto"
        >
          {CLAUDE_LIST_READY_PROMPT}
        </pre>

        <div>
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <p className="text-[12px] font-semibold text-slate-700">
              Draft queue JSON{' '}
              <span className="font-medium text-slate-400">· {agentPayload?.rows.length ?? 0} rows</span>
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
            id="list-ready-agent-json"
            className="whitespace-pre text-[10px] leading-snug font-mono bg-slate-900 text-slate-100 rounded-xl p-3 max-h-72 overflow-auto"
          >
            {agentJsonText}
          </pre>
        </div>
      </section>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
          <p className="text-[11px] font-medium text-slate-400">Queued</p>
          <p className="text-[20px] font-semibold tabular-nums mt-0.5">{counts.queued}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
          <p className="text-[11px] font-medium text-slate-400">Blocked</p>
          <p className="text-[20px] font-semibold tabular-nums mt-0.5">{counts.blocked}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
          <p className="text-[11px] font-medium text-slate-400">Drafted</p>
          <p className="text-[20px] font-semibold tabular-nums mt-0.5">{counts.drafted}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
          <p className="text-[11px] font-medium text-slate-400">Agent rows</p>
          <p className="text-[20px] font-semibold tabular-nums mt-0.5">{agentPayload?.rows.length ?? 0}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          id="list-ready-mark-drafted-both"
          onClick={() => markSelected('drafted_both')}
          disabled={!selected.size}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-700 text-white text-[12px] font-semibold disabled:opacity-40"
        >
          <Check size={14} /> Mark selected drafted both
        </button>
        <button
          type="button"
          onClick={() => markSelected('drafted_ka')}
          disabled={!selected.size}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-[12px] font-semibold disabled:opacity-40"
        >
          Mark drafted KA
        </button>
        <button
          type="button"
          onClick={() => markSelected('drafted_ebay')}
          disabled={!selected.size}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-[12px] font-semibold disabled:opacity-40"
        >
          Mark drafted eBay
        </button>
        <button
          type="button"
          onClick={() => markSelected('skipped')}
          disabled={!selected.size}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-[12px] font-semibold disabled:opacity-40"
        >
          Skip selected
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ['all', `All (${rows.length})`],
            ['queued', `Queued (${counts.queued})`],
            ['blocked', `Blocked (${counts.blocked})`],
            ['drafted', `Drafted (${counts.drafted})`],
            ['done', `Done (${counts.done})`],
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
          No saleReady items. Mark items Ready in Inventory (with photos), then Rebuild queue.
        </p>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2.5 w-8" />
                  <th className="px-3 py-2.5">Item</th>
                  <th className="px-3 py-2.5 text-right">KA</th>
                  <th className="px-3 py-2.5 text-right">eBay</th>
                  <th className="px-3 py-2.5 text-right">Photos</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Quick</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((r) => (
                  <tr key={r.itemId} className="hover:bg-slate-50/80">
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={selected.has(r.itemId)}
                        onChange={() => toggleSelect(r.itemId)}
                        aria-label={`Select ${r.inventoryName}`}
                      />
                    </td>
                    <td className="px-3 py-2.5 max-w-[16rem]">
                      <p className="font-semibold text-slate-900 truncate" title={r.inventoryName}>
                        {r.inventoryName}
                      </p>
                      <p className="text-[10px] text-slate-400 truncate">
                        {r.category}
                        {r.subCategory ? ` / ${r.subCategory}` : ''} · buy {formatEURPrefix(r.buyPrice)}
                      </p>
                      {r.blockers.length > 0 && (
                        <p className="text-[10px] text-amber-700 font-medium mt-0.5">
                          {r.blockers.join(', ')}
                        </p>
                      )}
                      {r.inventoryNote && (
                        <p className="text-[10px] text-slate-400 truncate mt-0.5" title={r.inventoryNote}>
                          {r.inventoryNote}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                      {r.priceKa != null ? formatEURPrefix(r.priceKa) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                      {r.priceEbay != null ? formatEURPrefix(r.priceEbay) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.photoCount}</td>
                    <td className="px-3 py-2.5 text-[11px] font-semibold text-slate-600">
                      {statusLabel(r.status)}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          className="text-[10px] font-semibold text-slate-500 hover:text-slate-900"
                          onClick={() => markRow(r, 'drafted_both')}
                        >
                          Both
                        </button>
                        <button
                          type="button"
                          className="text-[10px] font-semibold text-slate-500 hover:text-slate-900"
                          onClick={() => markRow(r, 'drafted_ka')}
                        >
                          KA
                        </button>
                        <button
                          type="button"
                          className="text-[10px] font-semibold text-slate-500 hover:text-slate-900"
                          onClick={() => markRow(r, 'drafted_ebay')}
                        >
                          eBay
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default ListReadyPage;
