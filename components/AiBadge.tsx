/**
 * Provenance markers for records the AI assistant touched.
 *
 * The badge is permanent (it records where the data came from); the stripe/dot only
 * signal that a change is still waiting for the user's review.
 */

import React from 'react';
import { Bot } from 'lucide-react';
import type { AiAction, AiReviewStatus, InventoryItem } from '../types';
import type { ItemAiState } from '../services/aiActionLog';

const ACTION_LABELS: Record<string, string> = {
  item_created: 'Item added',
  item_updated: 'Item updated',
  marked_sold: 'Marked as sold',
  marked_received: 'Marked as received',
  buyer_info_filled: 'Buyer details filled',
  field_changed: 'Field changed',
  inbox_created: 'Added to inbox',
  inbox_updated: 'Inbox entry updated',
  item_deleted: 'Moved to trash',
};

export function formatAiActionLabel(actionType: string): string {
  return ACTION_LABELS[actionType] || actionType.replace(/_/g, ' ');
}

/** True when the record carries AI provenance from either the item flags or the log. */
export function isAiTouched(
  item: Pick<InventoryItem, 'source' | 'aiReviewStatus'> | undefined,
  aiState?: ItemAiState
): boolean {
  return Boolean(item?.source === 'ai' || item?.aiReviewStatus || aiState?.touchedByAi);
}

/** True while at least one AI change on this record is still unreviewed. */
export function hasUnreviewedAi(
  item: Pick<InventoryItem, 'aiReviewStatus'> | undefined,
  aiState?: ItemAiState
): boolean {
  if (aiState) return aiState.unreviewedCount > 0;
  return item?.aiReviewStatus === 'unreviewed';
}

function buildTitle(aiState?: ItemAiState, reviewStatus?: AiReviewStatus): string {
  const latest: AiAction | undefined = aiState?.latest;
  const parts: string[] = ['Touched by the AI assistant'];
  if (latest) {
    const when = new Date(latest.timestamp);
    parts.push(`${formatAiActionLabel(latest.actionType)} · ${when.toLocaleString()}`);
    if (latest.sourceContext) parts.push(latest.sourceContext);
  }
  const status = reviewStatus || latest?.reviewStatus;
  if (aiState && aiState.unreviewedCount > 0) {
    parts.push(`${aiState.unreviewedCount} change${aiState.unreviewedCount === 1 ? '' : 's'} awaiting review`);
  } else if (status === 'approved') {
    parts.push('Approved by you');
  } else if (status === 'reverted') {
    parts.push('Reverted');
  }
  return parts.join(' — ');
}

interface AiBadgeProps {
  aiState?: ItemAiState;
  /** Falls back to the item's own flag when no log entry is available. */
  reviewStatus?: AiReviewStatus;
  size?: 'xs' | 'sm';
  /** Icon only — for dense table rows. */
  compact?: boolean;
  className?: string;
}

/** Small violet "AI" chip shown next to a record's name. */
const AiBadge: React.FC<AiBadgeProps> = ({
  aiState,
  reviewStatus,
  size = 'xs',
  compact = false,
  className = '',
}) => {
  const unreviewed = (aiState?.unreviewedCount || 0) > 0 || reviewStatus === 'unreviewed';
  const reverted = !unreviewed && (reviewStatus === 'reverted' || aiState?.latest?.reviewStatus === 'reverted');
  const tone = unreviewed
    ? 'bg-violet-100 text-violet-800 border-violet-300'
    : reverted
      ? 'bg-slate-100 text-slate-500 border-slate-200'
      : 'bg-violet-50 text-violet-600 border-violet-200';
  const pad = size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-1 py-[1px] text-[9px]';

  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded border font-black uppercase tracking-wide shrink-0 ${pad} ${tone} ${className}`}
      title={buildTitle(aiState, reviewStatus)}
    >
      <Bot size={size === 'sm' ? 11 : 9} className="shrink-0" />
      {!compact && 'AI'}
      {unreviewed && (aiState?.unreviewedCount || 0) > 1 && (
        <span className="tabular-nums">{aiState?.unreviewedCount}</span>
      )}
    </span>
  );
};

interface AiProvenanceNoteProps {
  aiState?: ItemAiState;
  reviewStatus?: AiReviewStatus;
  /** Rendered as the "review it" affordance (usually a Link to /panel/ai-actions). */
  action?: React.ReactNode;
  className?: string;
}

/** Inline note for detail views: what the AI did to this record and whether it is reviewed. */
export const AiProvenanceNote: React.FC<AiProvenanceNoteProps> = ({
  aiState,
  reviewStatus,
  action,
  className = '',
}) => {
  if (!isAiTouched(undefined, aiState) && !reviewStatus) return null;
  const unreviewed = (aiState?.unreviewedCount || 0) > 0 || reviewStatus === 'unreviewed';
  const latest = aiState?.latest;

  return (
    <div
      className={`flex items-start gap-2.5 rounded-xl border px-3 py-2 ${
        unreviewed ? 'border-violet-300 bg-violet-50' : 'border-slate-200 bg-slate-50'
      } ${className}`}
    >
      <Bot size={16} className={`shrink-0 mt-0.5 ${unreviewed ? 'text-violet-600' : 'text-slate-400'}`} />
      <div className="min-w-0 flex-1">
        <p className={`text-xs font-black ${unreviewed ? 'text-violet-900' : 'text-slate-700'}`}>
          {unreviewed
            ? `Edited by the AI assistant — ${aiState?.unreviewedCount} change${
                aiState?.unreviewedCount === 1 ? '' : 's'
              } awaiting your review`
            : 'Edited by the AI assistant — reviewed'}
        </p>
        {latest && (
          <p className="text-[11px] font-semibold text-slate-500 mt-0.5 truncate">
            {formatAiActionLabel(latest.actionType)} · {new Date(latest.timestamp).toLocaleString()}
            {latest.sourceContext ? ` · ${latest.sourceContext}` : ''}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
};

export default AiBadge;
