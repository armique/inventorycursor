import React from 'react';
import type { InventoryItem } from '../types';
import {
  accessoryToggleLabel,
  accessoryTogglePatch,
  accessoryTogglePresent,
  accessoryTogglesForItem,
  type AccessoryToggleId,
} from '../utils/itemAccessoryToggles';

interface Props {
  item: InventoryItem;
  onPatch: (patch: Partial<InventoryItem>) => void;
  dense?: boolean;
}

const ItemAccessoryToggles: React.FC<Props> = ({ item, onPatch, dense }) => {
  const ids = accessoryTogglesForItem(item);

  const toggle = (id: AccessoryToggleId) => {
    const next = !accessoryTogglePresent(item, id);
    onPatch(accessoryTogglePatch(id, next));
  };

  return (
    <div
      className={`flex items-center gap-1 flex-wrap ${dense ? 'mt-0.5' : 'mt-1'}`}
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
            className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[9px] font-black uppercase tracking-wide transition-colors ${
              present
                ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                : 'bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100 hover:text-slate-600'
            }`}
            title={
              present
                ? `${label} present — click to mark missing`
                : `${label} missing — click to mark present`
            }
            aria-pressed={present}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
};

export default ItemAccessoryToggles;
