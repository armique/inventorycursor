import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';

export type BulkActionVariant =
  | 'primary'
  | 'secondary'
  | 'danger'
  | 'violet'
  | 'emerald'
  | 'indigo';

export interface BulkAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  variant?: BulkActionVariant;
  disabled?: boolean;
  hidden?: boolean;
}

interface Props {
  count: number;
  onClear: () => void;
  actions: BulkAction[];
  /** Called when expand/collapse changes (parent can adjust scroll padding). */
  onExpandedChange?: (expanded: boolean) => void;
}

const variantClass: Record<BulkActionVariant, string> = {
  primary: 'bg-white text-slate-900 hover:bg-slate-100',
  secondary: 'bg-slate-800 text-white border border-slate-700 hover:bg-slate-700',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  violet: 'bg-violet-600 text-white hover:bg-violet-700',
  emerald: 'bg-emerald-600 text-white hover:bg-emerald-700',
  indigo: 'bg-indigo-600 text-white hover:bg-indigo-700',
};

/**
 * Bulk actions dock: on phone sits above the app bottom nav; table area gets bottom padding so rows stay visible.
 */
const BulkSelectionBar: React.FC<Props> = ({ count, onClear, actions, onExpandedChange }) => {
  const [expanded, setExpanded] = useState(false);
  const visible = actions.filter((a) => !a.hidden);

  useEffect(() => {
    onExpandedChange?.(expanded);
  }, [expanded, onExpandedChange]);

  useEffect(() => {
    if (count === 0) setExpanded(false);
  }, [count]);

  const toggleExpanded = () => setExpanded((v) => !v);

  const actionButton = (action: BulkAction, fullWidth = false) => (
    <button
      key={action.id}
      type="button"
      onClick={action.onClick}
      disabled={action.disabled}
      className={`min-h-[44px] px-4 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation ${
        variantClass[action.variant || 'secondary']
      } ${fullWidth ? 'w-full' : 'shrink-0'}`}
    >
      {action.icon}
      <span className="truncate">{action.label}</span>
    </button>
  );

  return (
    <div
      className="fixed inset-x-0 z-[115] animate-in slide-in-from-bottom-4 duration-200 bottom-[calc(3.75rem+env(safe-area-inset-bottom,0px))] lg:bottom-6 lg:max-w-[min(100%,64rem)] lg:left-1/2 lg:-translate-x-1/2 lg:px-4"
      role="toolbar"
      aria-label={`${count} items selected`}
    >
      <div className="mx-0 lg:mx-auto bg-slate-900 border-t lg:border border-slate-800 shadow-[0_-12px_40px_rgba(15,23,42,0.35)] lg:rounded-[2rem] overflow-hidden pb-safe">
        {/* Mobile / tablet: compact bar + expandable action sheet */}
        <div className="lg:hidden">
          <div className="flex items-center gap-3 px-4 py-3 min-h-[56px]">
            <div className="shrink-0">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none">Selected</p>
              <p className="text-xl font-black text-white tabular-nums">{count}</p>
            </div>
            <button
              type="button"
              onClick={toggleExpanded}
              className="flex-1 min-h-[44px] flex items-center justify-center gap-2 rounded-2xl bg-white/10 border border-white/15 text-white font-black text-[10px] uppercase tracking-widest touch-manipulation"
            >
              {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
              {expanded ? 'Hide actions' : `${visible.length} actions`}
            </button>
            <button
              type="button"
              onClick={onClear}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-2xl text-slate-400 hover:text-white hover:bg-white/10 touch-manipulation"
              aria-label="Clear selection"
            >
              <X size={22} />
            </button>
          </div>
          {expanded && (
            <div className="px-4 pb-3 pt-0 grid grid-cols-2 gap-2 max-h-[min(50vh,320px)] overflow-y-auto overscroll-contain custom-scrollbar">
              {visible.map((a) => actionButton(a, true))}
            </div>
          )}
        </div>

        {/* Desktop: horizontal scrollable actions */}
        <div className="hidden lg:flex items-center gap-6 px-6 py-4">
          <div className="flex flex-col shrink-0">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Selected</p>
            <p className="text-xl font-black text-white tabular-nums">{count}</p>
          </div>
          <div className="h-10 w-px bg-slate-800 shrink-0" />
          <div className="flex gap-2 overflow-x-auto overscroll-x-contain custom-scrollbar min-w-0 flex-1 pb-0.5">
            {visible.map((a) => actionButton(a))}
          </div>
          <button
            type="button"
            onClick={onClear}
            className="p-3 text-slate-500 hover:text-white transition-colors shrink-0 rounded-xl hover:bg-white/10"
            aria-label="Clear selection"
          >
            <X size={20} />
          </button>
        </div>
      </div>
    </div>
  );
};

/** Tailwind classes: extra bottom padding on scroll areas so rows stay above the bulk bar (+ mobile nav). */
export function bulkSelectionPadClass(expanded: boolean, hasSelection: boolean): string {
  if (!hasSelection) return '';
  if (expanded) {
    return 'pb-[calc(20rem+3.75rem+env(safe-area-inset-bottom,0px))] lg:pb-[24rem]';
  }
  return 'pb-[calc(5.5rem+3.75rem+env(safe-area-inset-bottom,0px))] lg:pb-28';
}

export default BulkSelectionBar;
