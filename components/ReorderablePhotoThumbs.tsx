import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GripVertical } from 'lucide-react';
import { reorderList } from '../utils/reorderList';

const HOLD_MS = 220;
const MOVE_CANCEL_HOLD_PX = 10;

type Props = {
  urls: string[];
  onReorder: (next: string[]) => void;
  /** grid = item form gallery; row = horizontal strip (Listing Studio) */
  layout?: 'grid' | 'row';
  onOpen?: (index: number) => void;
  /** Extra controls under each thumb (e.g. Main / Remove). Hidden while dragging. */
  renderActions?: (url: string, index: number) => React.ReactNode;
  className?: string;
  thumbClassName?: string;
  /** Extra node at the end of a row layout (e.g. add-photo button). */
  trailing?: React.ReactNode;
};

/**
 * Hold (touch or left-click) then drag to reorder photo miniatures.
 * First image is treated as the main photo by callers.
 */
const ReorderablePhotoThumbs: React.FC<Props> = ({
  urls,
  onReorder,
  layout = 'grid',
  onOpen,
  renderActions,
  className,
  thumbClassName,
  trailing,
}) => {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const overIndexRef = useRef<number | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const suppressClickRef = useRef(false);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  const clearHoldTimer = () => {
    if (holdTimerRef.current != null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const endDrag = useCallback(
    (commit: boolean) => {
      clearHoldTimer();
      const from = dragIndexRef.current;
      const to = overIndexRef.current;
      draggingRef.current = false;
      dragIndexRef.current = null;
      overIndexRef.current = null;
      pointerIdRef.current = null;
      startPosRef.current = null;
      setDragIndex(null);
      setOverIndex(null);
      if (commit && from != null && to != null && from !== to) {
        suppressClickRef.current = true;
        onReorder(reorderList(urls, from, to));
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 80);
      }
    },
    [onReorder, urls]
  );

  useEffect(() => {
    return () => clearHoldTimer();
  }, []);

  const indexFromPoint = (clientX: number, clientY: number): number | null => {
    const el = document.elementFromPoint(clientX, clientY);
    if (!el) return null;
    const node = (el as HTMLElement).closest('[data-photo-thumb-index]');
    if (!node) return null;
    const raw = node.getAttribute('data-photo-thumb-index');
    const idx = raw != null ? Number(raw) : NaN;
    return Number.isFinite(idx) ? idx : null;
  };

  const beginDrag = (index: number, target: HTMLElement, pointerId: number) => {
    draggingRef.current = true;
    dragIndexRef.current = index;
    overIndexRef.current = index;
    setDragIndex(index);
    setOverIndex(index);
    try {
      target.setPointerCapture(pointerId);
    } catch {
      /* ignore */
    }
    if (navigator.vibrate) {
      try {
        navigator.vibrate(12);
      } catch {
        /* ignore */
      }
    }
  };

  const onPointerDown = (e: React.PointerEvent, index: number) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Don't start hold from action buttons
    if ((e.target as HTMLElement).closest('[data-photo-action]')) return;

    pointerIdRef.current = e.pointerId;
    startPosRef.current = { x: e.clientX, y: e.clientY };
    clearHoldTimer();
    const target = e.currentTarget as HTMLElement;
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      if (pointerIdRef.current !== e.pointerId) return;
      beginDrag(index, target, e.pointerId);
    }, HOLD_MS);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointerIdRef.current !== e.pointerId) return;

    if (!draggingRef.current) {
      const start = startPosRef.current;
      if (start && holdTimerRef.current != null) {
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (Math.hypot(dx, dy) > MOVE_CANCEL_HOLD_PX) {
          clearHoldTimer();
        }
      }
      return;
    }

    e.preventDefault();
    const idx = indexFromPoint(e.clientX, e.clientY);
    if (idx == null || idx === overIndexRef.current) return;
    overIndexRef.current = idx;
    setOverIndex(idx);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (pointerIdRef.current !== e.pointerId) return;
    const wasDragging = draggingRef.current;
    endDrag(wasDragging);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    if (pointerIdRef.current !== e.pointerId) return;
    endDrag(false);
  };

  if (!urls.length) return null;

  const shell =
    layout === 'row'
      ? `flex gap-2 overflow-x-auto pb-1 -mx-0.5 px-0.5 snap-x snap-mandatory overscroll-x-contain ${className || ''}`
      : `grid grid-cols-3 md:grid-cols-5 gap-2 ${className || ''}`;

  return (
    <div className={shell}>
      {urls.map((url, index) => {
        const isMain = index === 0;
        const isDragging = dragIndex === index;
        const isOver = overIndex === index && dragIndex != null && dragIndex !== index;
        return (
          <div
            key={url}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            data-photo-thumb-index={index}
            onPointerDown={(e) => onPointerDown(e, index)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onClick={() => {
              if (suppressClickRef.current || draggingRef.current) return;
              onOpen?.(index);
            }}
            className={`relative select-none ${
              layout === 'row'
                ? `shrink-0 w-[4.5rem] sm:w-20 snap-start ${thumbClassName || ''}`
                : thumbClassName || ''
            } ${isDragging ? 'opacity-60 scale-[1.03] z-10 touch-none' : ''} ${
              isOver ? 'ring-2 ring-sky-400 ring-offset-1' : ''
            }`}
            style={{ touchAction: isDragging ? 'none' : 'manipulation' }}
            title="Hold, then drag to reorder · first = main"
          >
            <div
              className={`rounded-xl overflow-hidden border-2 bg-slate-100 ${
                layout === 'row' ? 'w-full h-[4.5rem] sm:h-20' : ''
              } ${
                isMain
                  ? 'border-rose-500 ring-2 ring-rose-200'
                  : isOver
                    ? 'border-sky-400'
                    : 'border-slate-200'
              } ${layout === 'grid' ? 'p-0' : ''}`}
            >
              <div className={layout === 'grid' ? 'p-1.5' : 'contents'}>
                <div className={`relative ${layout === 'grid' ? 'rounded-md overflow-hidden' : 'w-full h-full'}`}>
                  <img
                    src={url}
                    alt=""
                    className={
                      layout === 'grid'
                        ? 'w-full h-16 object-cover rounded-md border border-slate-200 bg-slate-100 pointer-events-none'
                        : 'w-full h-full object-cover pointer-events-none'
                    }
                    draggable={false}
                  />
                  <span className="absolute top-1 left-1 inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-black/55 text-white text-[8px] font-black leading-none pointer-events-none">
                    <GripVertical size={9} />
                    {isMain ? 'MAIN' : index + 1}
                  </span>
                  {layout === 'row' && isMain && (
                    <span className="absolute bottom-0.5 left-0.5 px-1 py-px rounded bg-rose-600 text-white text-[8px] font-black uppercase leading-none pointer-events-none">
                      Main
                    </span>
                  )}
                </div>
                {layout === 'grid' && renderActions && !isDragging && (
                  <div className="mt-1.5" data-photo-action>
                    {renderActions(url, index)}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {layout === 'row' && trailing}
    </div>
  );
};

export default ReorderablePhotoThumbs;
