import React, { useEffect, useRef, useState } from 'react';
import { Package, Shield } from 'lucide-react';
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
  /** Show OVP / IO labels next to the icon (inventory under-title row). */
  labeled?: boolean;
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

const FLUSH_MS = 280;

/**
 * OVP / IO Blende chips. Optimistic local state + debounced persist so rapid clicks
 * don't flood inventory updates / undo history / re-renders.
 */
const ItemAccessoryToggles: React.FC<Props> = ({ item, children, onPatch, dense, mini, labeled }) => {
  const ids = accessoryTogglesForItem(item, children);
  const iconSize = mini ? 10 : dense ? 11 : 12;
  const chip =
    labeled
      ? dense
        ? 'h-5 px-1.5 rounded-md gap-0.5'
        : 'h-6 px-1.5 rounded-lg gap-0.5'
      : mini
        ? 'h-5 w-5 rounded-md'
        : dense
          ? 'h-5 min-w-[1.25rem] px-1 rounded-md'
          : 'h-6 min-w-[1.5rem] px-1.5 rounded-lg';

  const [draft, setDraft] = useState<{ hasOVP?: boolean; hasIOShield?: boolean } | null>(null);
  const pendingRef = useRef<Partial<InventoryItem>>({});
  const timerRef = useRef<number | null>(null);
  const onPatchRef = useRef(onPatch);
  onPatchRef.current = onPatch;

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
      if (Object.keys(pending).length) {
        pendingRef.current = {};
        onPatchRef.current(pending);
      }
    };
  }, []);

  const flushSoon = () => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      const pending = pendingRef.current;
      pendingRef.current = {};
      if (Object.keys(pending).length) onPatchRef.current(pending);
    }, FLUSH_MS);
  };

  const handleClick = (id: AccessoryToggleId) => {
    const patch = cycleAccessoryTogglePatch(effective, id);
    setDraft((prev) => ({ ...(prev || {}), ...patch }));
    pendingRef.current = { ...pendingRef.current, ...patch };
    flushSoon();
  };

  return (
    <div
      className="flex items-center gap-0.5 flex-wrap"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {ids.map((id) => {
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
            className={`inline-flex items-center justify-center border transition-colors ${chip} ${toneClasses(state)}`}
            title={accessoryToggleTitle(id, state)}
            aria-label={`${label}: ${state}`}
            aria-pressed={state === 'present' ? true : state === 'missing' ? false : undefined}
          >
            <AccessoryIcon id={id} size={iconSize} />
            {labeled ? (
              <span className="text-[9px] font-black uppercase tracking-wide leading-none">
                {label}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
};

export default ItemAccessoryToggles;
