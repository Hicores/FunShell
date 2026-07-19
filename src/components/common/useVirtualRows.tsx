import { useEffect, useMemo, useRef, useState } from "react";

const FALLBACK_VISIBLE_ROWS = 40;

export interface VirtualRange {
  start: number;
  end: number;
}

export function calculateVirtualRange(
  total: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan = 8,
): VirtualRange {
  if (total <= 0) return { start: 0, end: 0 };
  const visibleHeight = viewportHeight > 0 ? viewportHeight : rowHeight * FALLBACK_VISIBLE_ROWS;
  const start = Math.max(0, Math.floor(Math.max(0, scrollTop) / rowHeight) - overscan);
  const visibleRows = Math.ceil(visibleHeight / rowHeight) + overscan * 2;
  return { start, end: Math.min(total, start + visibleRows) };
}

export function useVirtualRows<T>(items: T[], rowHeight: number, overscan = 8) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => setViewport({ scrollTop: container.scrollTop, height: container.clientHeight });
    measure();
    container.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(container);
    window.addEventListener("resize", measure);
    return () => {
      container.removeEventListener("scroll", measure);
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const range = calculateVirtualRange(items.length, Math.max(0, viewport.scrollTop - 29), viewport.height, rowHeight, overscan);
  const rows = useMemo(() => items.slice(range.start, range.end).map((item, offset) => ({
    item,
    index: range.start + offset,
  })), [items, range.end, range.start]);

  return {
    containerRef,
    rows,
    beforeHeight: range.start * rowHeight,
    afterHeight: (items.length - range.end) * rowHeight,
  };
}

export function VirtualTableSpacer({ height, columns }: { height: number; columns: number }) {
  if (height <= 0) return null;
  return <tr className="virtual-table-spacer" aria-hidden="true"><td colSpan={columns} style={{ height }} /></tr>;
}
