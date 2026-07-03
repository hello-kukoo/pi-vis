import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface VirtualListOptions {
  count: number;
  rowHeight: number;
  /** Minimum rows to render above and below the viewport. */
  minOverscan?: number;
  /** Viewport heights to render above and below the viewport. */
  overscanScreens?: number;
}

interface VirtualRow {
  index: number;
}

export interface VirtualListState<T extends HTMLElement> {
  containerRef: React.RefCallback<T>;
  onScroll: React.UIEventHandler<T>;
  rows: VirtualRow[];
  startIndex: number;
  endIndex: number;
  totalHeight: number;
  offsetY: number;
  ensureIndexVisible: (index: number) => void;
}

/**
 * Tiny fixed-row-height virtualizer for popup lists. It renders the visible
 * window plus a generous buffer so trackpad/fling scrolling does not reveal
 * blank space, while keeping huge option sets to O(visible) DOM nodes.
 */
export function useVirtualList<T extends HTMLElement>({
  count,
  rowHeight,
  minOverscan = 24,
  overscanScreens = 2,
}: VirtualListOptions): VirtualListState<T> {
  const nodeRef = useRef<T | null>(null);
  const [node, setNode] = useState<T | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const containerRef = useCallback<React.RefCallback<T>>((el) => {
    nodeRef.current = el;
    setNode(el);
    if (el) setViewportHeight(el.clientHeight);
  }, []);

  useEffect(() => {
    if (!node) return;

    const measure = () => setViewportHeight(node.clientHeight);
    measure();

    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [node]);

  useEffect(() => {
    const el = nodeRef.current;
    if (!el) return;
    const maxScrollTop = Math.max(0, count * rowHeight - el.clientHeight);
    if (el.scrollTop > maxScrollTop) {
      el.scrollTop = maxScrollTop;
      setScrollTop(maxScrollTop);
    }
  }, [count, rowHeight]);

  const onScroll = useCallback<React.UIEventHandler<T>>((event) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  const visibleRows = viewportHeight > 0 ? Math.ceil(viewportHeight / rowHeight) : 12;
  const overscan = Math.max(minOverscan, Math.ceil(visibleRows * overscanScreens));

  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(
    count,
    Math.ceil((scrollTop + Math.max(viewportHeight, rowHeight)) / rowHeight) + overscan,
  );

  const rows = useMemo<VirtualRow[]>(() => {
    const out: VirtualRow[] = [];
    for (let i = startIndex; i < endIndex; i++) out.push({ index: i });
    return out;
  }, [startIndex, endIndex]);

  const ensureIndexVisible = useCallback(
    (index: number) => {
      const el = nodeRef.current;
      if (!el || index < 0 || index >= count) return;
      const top = index * rowHeight;
      const bottom = top + rowHeight;
      const viewTop = el.scrollTop;
      const viewBottom = viewTop + el.clientHeight;
      if (top < viewTop) {
        el.scrollTop = top;
        setScrollTop(top);
      } else if (bottom > viewBottom) {
        const next = bottom - el.clientHeight;
        el.scrollTop = next;
        setScrollTop(next);
      }
    },
    [count, rowHeight],
  );

  return {
    containerRef,
    onScroll,
    rows,
    startIndex,
    endIndex,
    totalHeight: count * rowHeight,
    offsetY: startIndex * rowHeight,
    ensureIndexVisible,
  };
}
