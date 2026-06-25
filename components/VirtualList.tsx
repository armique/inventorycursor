import React, { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

const VIRTUAL_THRESHOLD = 80;

interface Props<T> {
  items: T[];
  estimateSize?: number;
  className?: string;
  renderItem: (item: T, index: number) => React.ReactNode;
  getKey: (item: T, index: number) => string | number;
}

export function VirtualList<T>({
  items,
  estimateSize = 72,
  className = '',
  renderItem,
  getKey,
}: Props<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const useVirtual = items.length > VIRTUAL_THRESHOLD;

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan: 6,
    getItemKey: (index) => String(getKey(items[index]!, index)),
  });

  if (!useVirtual) {
    return <div className={className}>{items.map((item, i) => renderItem(item, i))}</div>;
  }

  return (
    <div ref={parentRef} className={`overflow-y-auto custom-scrollbar ${className}`}>
      <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
        {rowVirtualizer.getVirtualItems().map((vRow) => {
          const item = items[vRow.index]!;
          return (
            <div
              key={getKey(item, vRow.index)}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translate3d(0, ${vRow.start}px, 0)`,
              }}
            >
              {renderItem(item, vRow.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
