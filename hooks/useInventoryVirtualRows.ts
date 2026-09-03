import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * ArmikTech-style row windowing for the inventory table.
 * Renders only visible rows + overscan; remembers measured heights per item id.
 * Uses the table's scroll container (not window scroll).
 *
 * Stores the visible *slice* (start/end), not scroll position — setState only when
 * the slice moves, so scrolling does not re-render the tbody sixty times a second.
 */

export interface InventoryVirtualRows {
  start: number;
  end: number;
  padTop: number;
  padBottom: number;
  measureRef: (id: string) => (node: HTMLElement | null) => void;
}

export interface InventoryVirtualRowsOptions {
  ids: string[];
  scrollElement: HTMLElement | null;
  estimate?: number;
  overscan?: number;
  /** Below this count, render every row (filters often yield short lists). */
  threshold?: number;
}

const SCROLL_IDLE_MS = 120;

export function useInventoryVirtualRows({
  ids,
  scrollElement,
  estimate = 56,
  overscan = 6,
  threshold = 60,
}: InventoryVirtualRowsOptions): InventoryVirtualRows {
  const [measureVersion, setMeasureVersion] = useState(0);
  const heights = useRef(new Map<string, number>());
  const pendingMeasure = useRef(false);
  const offsetsRef = useRef<number[]>([]);
  const [range, setRange] = useState({ start: 0, end: 40 });

  const enabled = ids.length >= threshold;

  const { offsets, total } = useMemo(() => {
    const running: number[] = new Array(ids.length + 1);
    running[0] = 0;
    for (let i = 0; i < ids.length; i += 1) {
      running[i + 1] = running[i] + (heights.current.get(ids[i]) ?? estimate);
    }
    offsetsRef.current = running;
    return { offsets: running, total: running[ids.length] };
  }, [ids, estimate, measureVersion]);

  useEffect(() => {
    setRange({ start: 0, end: Math.min(ids.length, overscan * 3 + 12) });
  }, [ids, overscan]);

  useEffect(() => {
    const el = scrollElement;
    if (!el || !enabled) return;

    let scrollIdleTimer = 0;

    const sample = () => {
      const running = offsetsRef.current;
      const count = running.length - 1;
      if (count <= 0) return;

      const top = Math.max(0, el.scrollTop);
      const bottom = top + el.clientHeight;

      const find = (target: number) => {
        let low = 0;
        let high = count;
        while (low < high) {
          const mid = (low + high) >> 1;
          if (running[mid + 1] <= target) low = mid + 1;
          else high = mid;
        }
        return Math.min(low, Math.max(0, count - 1));
      };

      const next = {
        start: Math.max(0, find(top) - overscan),
        end: Math.min(count, find(bottom) + 1 + overscan),
      };

      setRange((current) =>
        current.start === next.start && current.end === next.end ? current : next,
      );
    };

    const onScroll = () => {
      el.setAttribute('data-scrolling', '');
      window.clearTimeout(scrollIdleTimer);
      scrollIdleTimer = window.setTimeout(() => {
        el.removeAttribute('data-scrolling');
      }, SCROLL_IDLE_MS);
      sample();
    };

    sample();
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', sample);
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', sample);
      window.clearTimeout(scrollIdleTimer);
      el.removeAttribute('data-scrolling');
    };
  }, [scrollElement, enabled, overscan]);

  useEffect(() => {
    if (!enabled || !scrollElement) return;
    const running = offsetsRef.current;
    const count = running.length - 1;
    if (count <= 0) return;

    const top = Math.max(0, scrollElement.scrollTop);
    const bottom = top + scrollElement.clientHeight;

    const find = (target: number) => {
      let low = 0;
      let high = count;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (running[mid + 1] <= target) low = mid + 1;
        else high = mid;
      }
      return Math.min(low, Math.max(0, count - 1));
    };

    const next = {
      start: Math.max(0, find(top) - overscan),
      end: Math.min(count, find(bottom) + 1 + overscan),
    };

    setRange((current) =>
      current.start === next.start && current.end === next.end ? current : next,
    );
  }, [measureVersion, enabled, scrollElement, overscan]);

  const measureRef = useCallback(
    (id: string) => (node: HTMLElement | null) => {
      if (!node) return;
      const measured = node.getBoundingClientRect().height;
      if (!measured) return;

      const known = heights.current.get(id);
      if (known !== undefined && Math.abs(known - measured) <= 0.5) return;

      heights.current.set(id, measured);
      if (pendingMeasure.current) return;
      pendingMeasure.current = true;
      requestAnimationFrame(() => {
        pendingMeasure.current = false;
        setMeasureVersion((n) => n + 1);
      });
    },
    [],
  );

  if (!enabled) {
    return {
      start: 0,
      end: ids.length,
      padTop: 0,
      padBottom: 0,
      measureRef,
    };
  }

  const start = Math.min(range.start, Math.max(0, ids.length - 1));
  const end = Math.min(range.end, ids.length);

  return {
    start,
    end,
    padTop: offsets[start] ?? 0,
    padBottom: Math.max(0, total - (offsets[end] ?? total)),
    measureRef,
  };
}
