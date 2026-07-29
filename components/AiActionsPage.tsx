/**
 * "Done by AI" — chronological feed of every change the assistant made, with the exact
 * before/after values, where the data came from, and per-action Approve / Revert.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCheck,
  Cloud,
  Loader2,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import type { AiAction, AiActionType, AiReviewStatus, InventoryItem, ItemUpdateOptions } from '../types';
import {
  clearAiActionsEverywhere,
  pullAiActionsFromCloud,
  setAiActionReviewStatus,
} from '../services/aiActionLog';
import { applyRevert, describeConflict, planRevert, type RevertPlan } from '../services/aiActionRevert';
import { formatDiffValue, formatFieldLabel } from '../utils/aiDiff';
import { useAiActions } from '../hooks/useAiActions';
import { formatAiActionLabel } from './AiBadge';
import ItemThumbnail from './ItemThumbnail';

interface Props {
  items: InventoryItem[];
  onUpdate: (items: InventoryItem[], deleteIds?: string[], options?: ItemUpdateOptions) => void;
}

type StatusTab = 'unreviewed' | 'approved' | 'reverted' | 'all';

const ACTION_TYPE_OPTIONS: { id: AiActionType | 'ALL'; label: string }[] = [
  { id: 'ALL', label: 'All actions' },
  { id: 'item_created', label: 'Item added' },
  { id: 'item_updated', label: 'Item updated' },
  { id: 'field_changed', label: 'Field changed' },
  { id: 'marked_sold', label: 'Marked as sold' },
  { id: 'marked_received', label: 'Marked as received' },
  { id: 'buyer_info_filled', label: 'Buyer details' },
  { id: 'inbox_created', label: 'Inbox added' },
  { id: 'inbox_updated', label: 'Inbox updated' },
  { id: 'item_deleted', label: 'Moved to trash' },
];

function statusTone(status: AiReviewStatus): string {
  if (status === 'approved') return 'bg-emerald-50 text-emerald-800 border-emerald-200';
  if (status === 'reverted') return 'bg-slate-100 text-slate-600 border-slate-200';
  return 'bg-violet-50 text-violet-800 border-violet-300';
}

const AiActionsPage: React.FC<Props> = ({ items, onUpdate }) => {
  const navigate = useNavigate();
  const { actions } = useAiActions();
  const [statusTab, setStatusTab] = useState<StatusTab>('unreviewed');
  const [typeFilter, setTypeFilter] = useState<AiActionType | 'ALL'>('ALL');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflictPlan, setConflictPlan] = useState<RevertPlan | null>(null);
  const [pulling, setPulling] = useState(false);

  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // The cloud archive is only fetched here — normal panel usage adds no reads for it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPulling(true);
      const result = await pullAiActionsFromCloud();
      if (!cancelled && result.error) setError(result.error);
      if (!cancelled) setPulling(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(
    () => ({
      unreviewed: actions.filter((a) => a.reviewStatus === 'unreviewed').length,
      approved: actions.filter((a) => a.reviewStatus === 'approved').length,
      reverted: actions.filter((a) => a.reviewStatus === 'reverted').length,
      all: actions.length,
    }),
    [actions]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return actions.filter((a) => {
      if (statusTab !== 'all' && a.reviewStatus !== statusTab) return false;
      if (typeFilter !== 'ALL' && a.actionType !== typeFilter) return false;
      const day = a.timestamp.slice(0, 10);
      if (fromDate && day < fromDate) return false;
      if (toDate && day > toDate) return false;
      if (q) {
        const haystack = [
          a.itemName,
          a.sourceContext,
          formatAiActionLabel(a.actionType),
          ...a.diff.map((d) => `${formatFieldLabel(d.field)} ${formatDiffValue(d.newValue)}`),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [actions, statusTab, typeFilter, fromDate, toDate, query]);

  /** Push the review flag onto the item too, so list badges/stripes follow the feed. */
  const stampItemReviewStatus = (itemId: string, reviewStatus: AiReviewStatus) => {
    const item = itemsById.get(itemId);
    if (!item) return;
    onUpdate([{ ...item, aiReviewStatus: reviewStatus }], undefined, {
      skipAiLog: true,
      skipActionLog: true,
      skipUndo: true,
    });
  };

  const approve = (action: AiAction) => {
    setAiActionReviewStatus([action.id], 'approved');
    if (action.targetKind === 'item') stampItemReviewStatus(action.itemId, 'approved');
    setError(null);
    setMessage(`Approved: ${action.itemName || action.itemId}`);
  };

  const approveAll = () => {
    const pending = filtered.filter((a) => a.reviewStatus === 'unreviewed');
    if (!pending.length) return;
    if (!window.confirm(`Approve ${pending.length} AI change${pending.length === 1 ? '' : 's'} shown here?`)) {
      return;
    }
    setAiActionReviewStatus(
      pending.map((a) => a.id),
      'approved'
    );
    const touched = new Map<string, InventoryItem>();
    for (const a of pending) {
      if (a.targetKind !== 'item') continue;
      const item = itemsById.get(a.itemId);
      if (item) touched.set(item.id, { ...item, aiReviewStatus: 'approved' });
    }
    if (touched.size) {
      onUpdate(Array.from(touched.values()), undefined, {
        skipAiLog: true,
        skipActionLog: true,
        skipUndo: true,
      });
    }
    setError(null);
    setMessage(`Approved ${pending.length} change${pending.length === 1 ? '' : 's'}`);
  };

  const finishRevert = (plan: RevertPlan, forceFields?: string[]) => {
    const item = itemsById.get(plan.action.itemId);
    if (!item) {
      setError('The item no longer exists.');
      return;
    }
    const result = applyRevert(plan, item, { forceFields });
    if (!result.item) {
      setError(`Nothing reverted — ${result.note}.`);
      return;
    }
    // skipFieldPreserve: revert clears fields on purpose; without it the preserve step
    // would put the AI's value straight back.
    onUpdate([result.item], undefined, { skipAiLog: true, skipFieldPreserve: true, flushCloud: true });
    setAiActionReviewStatus([plan.action.id], 'reverted', result.note);
    setError(null);
    setMessage(`Reverted “${plan.action.itemName || item.name}” — ${result.note}`);
  };

  const revert = (action: AiAction) => {
    const item = itemsById.get(action.itemId);
    const plan = planRevert(action, item);
    if (plan.blockedReason) {
      setError(plan.blockedReason);
      return;
    }
    if (action.actionType === 'item_created') {
      if (
        !window.confirm(
          `The AI created “${action.itemName}”. Reverting moves it to Trash. Continue?`
        )
      ) {
        return;
      }
      onUpdate([], [action.itemId], { skipAiLog: true, flushCloud: true });
      setAiActionReviewStatus([action.id], 'reverted', 'item moved to trash');
      setError(null);
      setMessage(`Reverted — “${action.itemName}” moved to Trash`);
      return;
    }
    if (plan.conflicts.length > 0) {
      setConflictPlan(plan);
      return;
    }
    finishRevert(plan);
  };

  const openItem = (action: AiAction) => {
    if (action.targetKind !== 'item') {
      navigate('/panel/inventory');
      return;
    }
    navigate(`/panel/inventory?focus=${encodeURIComponent(action.itemId)}`);
  };

  return (
    <div className="w-full min-w-0 -mx-2 sm:-mx-4 md:-mx-6 lg:-mx-8 px-2 sm:px-4 md:px-6 lg:px-8 pb-10 animate-in fade-in duration-300">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4 min-w-0">
          <div className="p-3 rounded-2xl bg-violet-600 text-white shrink-0 shadow-lg shadow-violet-600/20">
            <Bot size={26} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">Done by AI</h1>
            <p className="text-sm text-slate-500 font-medium mt-1">
              Every change the assistant made — with exact before/after values, and one-click approve or revert.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pulling && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-500 text-xs font-bold">
              <Cloud size={13} /> <Loader2 size={12} className="animate-spin" /> Syncing log…
            </span>
          )}
          <button
            type="button"
            onClick={approveAll}
            disabled={!filtered.some((a) => a.reviewStatus === 'unreviewed')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-500 font-bold text-sm shadow-sm disabled:opacity-40 disabled:pointer-events-none"
          >
            <CheckCheck size={16} />
            Approve all shown
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm('Clear the whole AI action log? Revert data will be lost.')) {
                void clearAiActionsEverywhere();
              }
            }}
            disabled={actions.length === 0}
            className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white text-red-700 border border-red-200 hover:bg-red-50 font-bold text-sm shadow-sm disabled:opacity-40 disabled:pointer-events-none"
          >
            <Trash2 size={16} />
            Clear log
          </button>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(
          [
            ['unreviewed', `To review · ${counts.unreviewed}`],
            ['approved', `Approved · ${counts.approved}`],
            ['reverted', `Reverted · ${counts.reverted}`],
            ['all', `All · ${counts.all}`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setStatusTab(id)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
              statusTab === id
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
            }`}
          >
            {label}
          </button>
        ))}

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as AiActionType | 'ALL')}
          className="py-1.5 px-2.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700"
        >
          {ACTION_TYPE_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>

        <label className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500">
          From
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="py-1.5 px-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700"
          />
        </label>
        <label className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500">
          To
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="py-1.5 px-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700"
          />
        </label>

        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by item, field or context…"
            className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
          />
        </div>
      </div>

      {(error || message) && (
        <div
          className={`mb-4 flex items-start gap-2 rounded-xl border px-3 py-2 text-xs font-bold ${
            error ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-900'
          }`}
        >
          {error ? <AlertTriangle size={14} className="shrink-0 mt-0.5" /> : <Check size={14} className="shrink-0 mt-0.5" />}
          <span className="flex-1">{error || message}</span>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setMessage(null);
            }}
            className="shrink-0 hover:opacity-70"
          >
            ×
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm py-20 px-6 text-center">
          <div className="inline-flex p-4 rounded-2xl bg-slate-50 text-slate-300 mb-4">
            <Bot size={32} />
          </div>
          <p className="font-black text-slate-700 text-lg">
            {actions.length === 0 ? 'The assistant has not changed anything yet' : 'Nothing matches these filters'}
          </p>
          <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
            {actions.length === 0
              ? 'Items you add by hand never appear here — only edits made while AI mode is on.'
              : 'Try another status tab or clear the date range.'}
          </p>
        </div>
      ) : (
        <ol className="space-y-2">
          {filtered.map((action) => {
            const item = itemsById.get(action.itemId);
            const when = new Date(action.timestamp);
            const unreviewed = action.reviewStatus === 'unreviewed';
            return (
              <li
                key={action.id}
                className={`bg-white border rounded-2xl shadow-sm overflow-hidden ${
                  unreviewed ? 'border-violet-300 shadow-[inset_4px_0_0_0_#7c3aed]' : 'border-slate-200'
                }`}
              >
                <div className="flex flex-wrap items-start gap-3 p-3.5">
                  <button
                    type="button"
                    onClick={() => openItem(action)}
                    className="shrink-0"
                    title="Open this item in the inventory list"
                  >
                    {item ? (
                      <ItemThumbnail
                        item={item}
                        className="w-11 h-11 rounded-xl object-cover border border-slate-100"
                        size={44}
                      />
                    ) : (
                      <span className="w-11 h-11 rounded-xl bg-slate-100 text-slate-300 flex items-center justify-center">
                        <Bot size={18} />
                      </span>
                    )}
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-lg border text-[10px] font-black uppercase tracking-wide ${statusTone(
                          action.reviewStatus
                        )}`}
                      >
                        {formatAiActionLabel(action.actionType)}
                      </span>
                      <button
                        type="button"
                        onClick={() => openItem(action)}
                        className="text-sm font-black text-slate-900 hover:text-violet-700 hover:underline truncate max-w-[22rem] text-left"
                      >
                        {action.itemName || action.itemId}
                      </button>
                      <span className="text-[11px] font-semibold text-slate-400 tabular-nums">
                        {when.toLocaleDateString()} {when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {action.reviewStatus !== 'unreviewed' && (
                        <span className="text-[10px] font-black uppercase text-slate-400">
                          {action.reviewStatus}
                          {action.reviewNote ? ` · ${action.reviewNote}` : ''}
                        </span>
                      )}
                    </div>

                    {action.sourceContext && (
                      <p className="mt-1 text-[11px] font-semibold text-slate-500 italic truncate" title={action.sourceContext}>
                        Source: {action.sourceContext}
                      </p>
                    )}

                    {action.diff.length > 0 && (
                      <div className="mt-2 overflow-x-auto">
                        <table className="text-[11px] border-collapse">
                          <tbody>
                            {action.diff.map((d) => (
                              <tr key={d.field}>
                                <td className="pr-3 py-0.5 font-black text-slate-500 whitespace-nowrap align-top">
                                  {formatFieldLabel(d.field)}
                                </td>
                                <td className="pr-2 py-0.5 font-semibold text-slate-400 line-through max-w-[16rem] truncate">
                                  {formatDiffValue(d.oldValue)}
                                </td>
                                <td className="pr-2 py-0.5 text-slate-300">→</td>
                                <td className="py-0.5 font-black text-slate-900 max-w-[16rem] truncate">
                                  {formatDiffValue(d.newValue)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                    {unreviewed && (
                      <button
                        type="button"
                        onClick={() => approve(action)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-black uppercase tracking-wide hover:bg-emerald-500"
                      >
                        <Check size={13} /> Approve
                      </button>
                    )}
                    {action.reviewStatus !== 'reverted' && (
                      <button
                        type="button"
                        onClick={() => revert(action)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-[11px] font-black uppercase tracking-wide hover:bg-amber-100"
                      >
                        <RotateCcw size={13} /> Revert
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {conflictPlan && (
        <div className="fixed inset-0 z-[200] bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-5 space-y-4">
            <div className="flex items-start gap-3">
              <span className="p-2 rounded-xl bg-amber-100 text-amber-700 shrink-0">
                <AlertTriangle size={20} />
              </span>
              <div className="min-w-0">
                <h2 className="text-lg font-black text-slate-900">Manual edits found</h2>
                <p className="text-sm text-slate-500 font-medium mt-0.5">
                  These fields changed after the AI touched them. Reverting them would discard your
                  own edit.
                </p>
              </div>
            </div>

            <ul className="space-y-1.5 max-h-52 overflow-y-auto">
              {conflictPlan.conflicts.map((c) => (
                <li
                  key={c.field}
                  className="text-xs font-semibold text-slate-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2"
                >
                  {describeConflict(c)}
                </li>
              ))}
            </ul>

            {conflictPlan.cleanFields.length > 0 && (
              <p className="text-xs font-bold text-slate-500">
                {conflictPlan.cleanFields.length} other field
                {conflictPlan.cleanFields.length === 1 ? '' : 's'} can be reverted cleanly.
              </p>
            )}

            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConflictPlan(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-bold hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={conflictPlan.cleanFields.length === 0}
                onClick={() => {
                  finishRevert(conflictPlan);
                  setConflictPlan(null);
                }}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 disabled:opacity-40"
              >
                Revert the rest, keep my edits
              </button>
              <button
                type="button"
                onClick={() => {
                  finishRevert(
                    conflictPlan,
                    conflictPlan.conflicts.map((c) => c.field)
                  );
                  setConflictPlan(null);
                }}
                className="px-4 py-2 rounded-xl bg-amber-600 text-white text-sm font-bold hover:bg-amber-500"
              >
                Overwrite everything
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="mt-5 text-[11px] font-semibold text-slate-400">
        Manual entries never show up here.{' '}
        <Link to="/panel/action-history" className="underline hover:text-slate-600">
          Action history
        </Link>{' '}
        still records every change, AI or not.
      </p>
    </div>
  );
};

export default AiActionsPage;
