'use client';

import { useCallback, useEffect, useRef } from 'react';
import { formatClockMs, formatValue } from '@/lib/canvasUtils';
import type { DataStore } from '@/lib/dataStore';
import type { SeriesMeta, Status } from '@/lib/types';

const ROW_HEIGHT = 28;
const OVERSCAN = 6;
const FOLLOW_THRESHOLD_PX = 40;
const REFRESH_MS = 250;

const STATUS_CLASS = ['status-ok', 'status-warn', 'status-crit'] as const;

/**
 * A conventional table binds each row to a React-owned object, which for
 * 100,000 live ticks would mean materializing and diffing 100,000 objects on
 * every render. This never does that: it keeps a small fixed pool of DOM row
 * elements (enough to cover the viewport plus overscan, typically ~25) and,
 * on scroll or on a slow timer, repositions them and rewrites their text
 * directly from the ring buffers by index. The buffers are already the
 * source of truth — this just reads from them, the same way the canvas
 * charts do.
 *
 * Ticks arrive at 10/second but text doesn't need to redraw that often for a
 * human to read it, so content refresh runs on a 250ms timer, not the shared
 * rAF loop. Scrolling itself is still handled synchronously in the scroll
 * handler so the table never feels laggy to the hand even though its content
 * updates slower than the charts.
 */
export function DataTable({
  store,
  series,
  height = 320,
}: {
  store: DataStore;
  series: readonly SeriesMeta[];
  height?: number;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const spacerRef = useRef<HTMLDivElement | null>(null);
  const poolRef = useRef<HTMLDivElement[]>([]);
  const followRef = useRef(true);
  const totalRef = useRef(0);

  const poolSize = Math.ceil(height / ROW_HEIGHT) + OVERSCAN * 2;

  const layout = useCallback(() => {
    const scroller = scrollRef.current;
    const spacer = spacerRef.current;
    if (!scroller || !spacer) return;

    const first = series[0] ? store.buffer(series[0].id) : undefined;
    const total = first ? first.length : 0;
    totalRef.current = total;

    const totalHeight = total * ROW_HEIGHT;
    spacer.style.height = `${totalHeight}px`;

    const scrollTop = scroller.scrollTop;
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);

    const pool = poolRef.current;
    for (let slot = 0; slot < pool.length; slot++) {
      const rowIndex = start + slot;
      const el = pool[slot];
      if (rowIndex >= total) {
        el.style.display = 'none';
        continue;
      }
      el.style.display = '';
      el.style.transform = `translateY(${rowIndex * ROW_HEIGHT}px)`;

      // Oldest-first: buffer index 0 is the oldest live point, which is
      // exactly display row 0 — no reversal needed, and it's what keeps the
      // "grow at the bottom" behaviour below correct.
      const cells = el.children;
      const tsCell = cells[0] as HTMLElement;
      tsCell.textContent = formatClockMs(first!.timeAt(rowIndex));

      for (let c = 0; c < series.length; c++) {
        const s = series[c];
        const buf = store.buffer(s.id);
        const cell = cells[c + 1] as HTMLElement;
        if (!buf || rowIndex >= buf.length) {
          cell.textContent = '—';
          cell.className = 'dt-cell';
          continue;
        }
        const v = buf.valueAt(rowIndex);
        const status = buf.statusAt(rowIndex) as Status;
        cell.textContent = formatValue(v, s.max - s.min);
        cell.className = `dt-cell ${STATUS_CLASS[status]}`;
      }
    }
  }, [store, series]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;

    const onScroll = () => {
      const atBottom =
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - FOLLOW_THRESHOLD_PX;
      followRef.current = atBottom;
      layout();
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });

    const timer = setInterval(() => {
      const prevTotal = totalRef.current;
      layout();
      // New rows landed while the user was already at the bottom edge — keep
      // them pinned there, same behaviour as a log tail. Anyone scrolled up
      // to inspect history is left alone; the table just gets taller under
      // them without moving their view.
      if (followRef.current && totalRef.current > prevTotal && scroller) {
        scroller.scrollTop = scroller.scrollHeight;
      }
    }, REFRESH_MS);

    layout();

    return () => {
      scroller.removeEventListener('scroll', onScroll);
      clearInterval(timer);
    };
  }, [layout]);

  const jumpToLatest = () => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    followRef.current = true;
    scroller.scrollTop = scroller.scrollHeight;
  };

  // Below a few hundred px wide, flex:1 columns would get crushed to
  // illegible slivers. Giving the row content a real minimum width and
  // scrolling it horizontally (with the header pinned via position:sticky)
  // is the standard fix — same trade as most data grids make on mobile.
  const tableWidth = 130 + series.length * 110;

  return (
    <div className="dt">
      <div className="dt-head">
        <span className="dt-title">Raw ticks</span>
        <button type="button" onClick={jumpToLatest}>
          Jump to latest
        </button>
      </div>

      <div className="dt-scroll" ref={scrollRef} style={{ height }}>
        <div className="dt-header-row" style={{ height: ROW_HEIGHT, minWidth: tableWidth }}>
          <span className="dt-header-cell dt-ts">Time</span>
          {series.map((s) => (
            <span key={s.id} className="dt-header-cell">
              {s.label} ({s.unit})
            </span>
          ))}
        </div>

        <div className="dt-spacer" ref={spacerRef} style={{ minWidth: tableWidth }}>
          {Array.from({ length: poolSize }, (_, i) => (
            <div
              key={i}
              className="dt-row"
              style={{ height: ROW_HEIGHT }}
              ref={(el) => {
                if (el) poolRef.current[i] = el;
              }}
            >
              <span className="dt-cell dt-ts" />
              {series.map((s) => (
                <span key={s.id} className="dt-cell" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
