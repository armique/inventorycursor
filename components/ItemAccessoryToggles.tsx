import React from 'react';
import { Package, Receipt, Shield } from 'lucide-react';
import type { InventoryItem } from '../types';
import {
  accessoryToggleLabel,
  accessoryTogglePatch,
  accessoryTogglePresent,
  accessoryTogglesForItem,
  type AccessoryToggleId,
} from '../utils/itemAccessoryToggles';

interface Props {
  item: Pick<InventoryItem, 'category' | 'subCategory' | 'hasOVP' | 'hasIOShield' | 'hasReceipt'>;
  onPatch: (patch: Partial<InventoryItem>) => void;
  /** Compact row for inventory lists / phones. */
  dense?: boolean;
  /** Extra-tight icon chips (Listing Studio / mobile). */
  mini?: boolean;
}

function AccessoryIcon({ id, size }: { id: AccessoryToggleId; size: number }) {
  switch (id) {
    case 'ovp':
      return <Package size={size} strokeWidth={2.4} />;
    case 'rechnung':
      return <Receipt size={size} strokeWidth={2.4} />;
    case 'io':
      return <Shield size={size} strokeWidth={2.4} />;
  }
}

const ItemAccessoryToggles: React.FC<Props> = ({ item, onPatch, dense, mini }) => {
  const ids = accessoryTogglesForItem(item);
  const iconSize = mini ? 10 : dense ? 11 : 12;
  const chip =
    mini
      ? 'h-5 w-5 rounded-md'
      : dense
        ? 'h-5 min-w-[1.25rem] px-1 rounded-md'
        : 'h-6 min-w-[1.5rem] px-1.5 rounded-lg';

  const toggle = (id: AccessoryToggleId) => {
    const next = !accessoryTogglePresent(item, id);
    onPatch(accessoryTogglePatch(id, next));
  };

  return (
    <div
      className={`flex items-center gap-0.5 flex-wrap ${mini ? 'mt-0' : dense ? 'mt-0.5' : 'mt-1'}`}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {ids.map((id) => {
        const present = accessoryTogglePresent(item, id);
        const label = accessoryToggleLabel(id);
        return (
          <button
            key={id}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggle(id);
            }}
            className={`inline-flex items-center justify-center border transition-colors ${chip} ${
              present
                ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                : 'bg-white text-slate-400 border-slate-300 hover:bg-slate-50 hover:text-slate-600'
            }`}
            title={
              present
                ? `${label} present — click to mark missing`
                : `${label} missing — click to mark present`
            }
            aria-label={label}
            aria-pressed={present}
          >
            <AccessoryIcon id={id} size={iconSize} />
          </button>
        );
      })}
    </div>
  );
};

export default ItemAccessoryToggles;
