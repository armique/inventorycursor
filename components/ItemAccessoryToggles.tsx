import React, { useEffect, useRef, useState } from 'react';
import { Package, Shield, type LucideIcon } from 'lucide-react';
import type { InventoryItem } from '../types';
import {
  accessoryToggleLabel,
  accessoryToggleState,
  accessoryToggleTitle,
  accessoryTogglesForItem,
  cycleAccessoryTogglePatch,
  type AccessoryChildRef,
  type AccessoryToggleId,
  type AccessoryTriState,
} from '../utils/itemAccessoryToggles';

interface Props {
  item: Pick<
    InventoryItem,
    | 'category'
    | 'subCategory'
    | 'isBundle'
    | 'isPC'
    | 'name'
    | 'componentIds'
    | 'hasOVP'
    | 'hasIOShield'
  >;
  /** Bundle/PC children — enables IO Blende when a motherboard part is present. */
  children?: AccessoryChildRef[];
  onPatch: (patch: Partial<InventoryItem>) => void;
  /** Compact row for inventory lists / phones. */
  dense?: boolean;
  /** Extra-tight icon chips (Listing Studio / mobile). */
  mini?: boolean;
  /** Show OVP / IO labels next to the icon (forms / toolbars). Inventory uses icons only. */
  labeled?: boolean;
  /** Fixed-width Flags column slots — always OVP + IO (IO ghost when N/A). */
  flags?: boolean;
  iconBtnClass?: string;
  renderGhost?: (Icon: LucideIcon) => React.ReactNode;
}

function AccessoryIcon({ id, size }: { id: AccessoryToggleId; size: number }) {
  if (id === 'ovp') return <Package size={size} strokeWidth={2.4} />;
  return <Shield size={size} strokeWidth={2.4} />;
}

function toneClasses(state: AccessoryTriState): string {
  if (state === 'present') {
    return 'bg-emerald-500 text-white border-emerald-600 shadow-sm shadow-emerald-500/35 ring-1 ring-emerald-600/40 hover:bg-emerald-600';
  }
  if (state === 'missing') {
    return 'bg-red-500 text-white border-red-600 shadow-sm shadow-red-500/35 ring-1 ring-red-600/40 hover:bg-red-600';
  }
  return 'bg-violet-500 text-white border-violet-600 shadow-sm shadow-violet-500/40 ring-1 ring-violet-600/50 hover:bg-violet-600';
}

function flagToneClasses(state: AccessoryTriState): string {
  if (state === 'present') {
    return 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100';
  }
  if (state === 'missing') {
    return 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100';
  }
  return 'border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100';
}

const FLUSH_MS = 280;

/**
 * OVP / IO Blende chips. Optimistic local state + debounced persist so rapid clicks
 * don't flood inventory updates / undo history / re-renders.
 */
const ItemAccessoryToggles: React.FC<Props> = ({
  item,
  children,
  onPatch,
  dense,
  mini,
  labeled,
  flags = false,
  iconBtnClass = 'h-7 w-7',
  renderGhost,
}) => {
  const ids = accessoryTogglesForItem(item, children);
  const ioRelevant = ids.includes('io');
  const iconSize = mini ? 12 : dense ? 11 : 12;
  const chip =
    labeled
      ? dense
        ? 'h-5 px-1.5 rounded-md gap-0.5'
        : 'h-6 px-1.5 rounded-lg gap-0.5'
      : mini
        ? 'h-7 w-7 rounded-md'
        : dense
          ? 'h-5 min-w-[1.25rem] px-1 rounded-md'
          : 'h-6 min-w-[1.5rem] px-1.5 rounded-lg';

  const flagChip = `${iconBtnClass} shrink-0 inline-flex items-center justify-center rounded-lg border transition-colors`;

  const [draft, setDraft] = useState<{ hasOVP?: boolean; hasIOShield?: boolean } | null>(null);
  const pendingRef = useRef<Partial<InventoryItem>>({});
  const timerRef = useRef<number | null>(null);
  const onPatchRef = useRef(onPatch);
  onPatchRef.current = onPatch;
  const itemRef = useRef(item);
  itemRef.current = item;

  const effective = draft ? { ...item, ...draft } : item;

  // Drop draft once parent caught up (or item switched).
  useEffect(() => {
    setDraft((prev) => {
      if (!prev) return null;
      const ovpMatch =
        !('hasOVP' in prev) || item.hasOVP === prev.hasOVP;
      const ioMatch =
        !('hasIOShield' in prev) || item.hasIOShield === prev.hasIOShield;
      return ovpMatch && ioMatch ? null : prev;
    });
  }, [item.hasOVP, item.hasIOShield]);

  useEffect(() => {
    return () => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const pending = pendingRef.current;
      pendingRef.current = {};
      const keys = Object.keys(pending) as (keyof InventoryItem)[];
      if (!keys.length) return;
      // Virtualized rows unmount constantly while scrolling — never flush a no-op
      // patch that would mark inventory dirty and push to the cloud.
      const current = itemRef.current;
      const changed = keys.some((k) => current[k] !== pending[k]);
      if (!changed) return;
      onPatchRef.current(pending);
    };
  }, []);

  const flushSoon = () => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      const pending = pendingRef.current;
      pendingRef.current = {};
      const keys = Object.keys(pending) as (keyof InventoryItem)[];
      if (!keys.length) return;
      const current = itemRef.current;
      const changed = keys.some((k) => current[k] !== pending[k]);
      if (!changed) return;
      onPatchRef.current(pending);
    }, FLUSH_MS);
  };

  const handleClick = (id: AccessoryToggleId) => {
    const patch = cycleAccessoryTogglePatch(effective, id);
    setDraft((prev) => ({ ...(prev || {}), ...patch }));
    pendingRef.current = { ...pendingRef.current, ...patch };
    flushSoon();
  };

  if (!ids.length && !flags) return null;

  const renderToggle = (id: AccessoryToggleId) => {
    const state = accessoryToggleState(effective, id);
    const label = accessoryToggleLabel(id);
    return (
      <button
        key={id}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleClick(id);
        }}
        className={`${flags ? flagChip : `inline-flex items-center justify-center border transition-colors ${chip}`} ${flags ? flagToneClasses(state) : toneClasses(state)}`}
        title={accessoryToggleTitle(id, state)}
        aria-label={`${label}: ${state}`}
        aria-pressed={state === 'present' ? true : state === 'missing' ? false : undefined}
      >
        <AccessoryIcon id={id} size={flags ? 13 : iconSize} />
        {labeled ? (
          <span className="text-[9px] font-black uppercase tracking-wide leading-none">
            {label}
          </span>
        ) : null}
      </button>
    );
  };

  if (flags) {
    const ghost = renderGhost ?? (() => null);
    return (
      <>
        {renderToggle('ovp')}
        {ioRelevant ? renderToggle('io') : ghost(Shield)}
      </>
    );
  }

  return (
    <div
      className="flex items-center gap-0.5 flex-wrap"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {ids.map((id) => renderToggle(id))}
    </div>
  );
};

export default ItemAccessoryToggles;
