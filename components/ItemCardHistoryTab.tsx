import React from 'react';
import type { InventoryItem } from '../types';
import UnifiedPriceHistory from './UnifiedPriceHistory';
import MovementHistoryList from './MovementHistoryList';
import SaleCycleHistory from './SaleCycleHistory';
import ItemHistoryTimeline from './ItemHistoryTimeline';

/** History tab — price deltas, movement/bundle lineage, sale cycles, field audit. */
const ItemCardHistoryTab: React.FC<{ item: InventoryItem }> = ({ item }) => {
  return (
    <div className="p-3 sm:p-4 space-y-5">
      <section className="space-y-2">
        <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
          Price changes
        </h4>
        <UnifiedPriceHistory item={item} />
      </section>

      <section className="space-y-2">
        <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
          Bundle / movement
        </h4>
        {(item.movementHistory || []).length ? (
          <MovementHistoryList item={item} />
        ) : (
          <p className="text-xs text-slate-500 font-medium">No bundle membership events.</p>
        )}
      </section>

      <section className="space-y-2">
        <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
          Sale & return cycles
        </h4>
        <SaleCycleHistory item={item} />
      </section>

      <section className="space-y-2">
        <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
          Field audit
        </h4>
        <ItemHistoryTimeline item={item} />
      </section>
    </div>
  );
};

export default ItemCardHistoryTab;
