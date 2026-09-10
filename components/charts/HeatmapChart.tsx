'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useChartInteraction } from '@/hooks/useChartInteraction';
import { useChartRenderer } from '@/hooks/useChartRenderer';
import { useTimeRangeSync } from '@/hooks/useTimeRangeSync';
import { AGGREGATION_MS, type AggregationMode } from '@/components/providers/DataProvider';
import { bucketAggregate, pickBucketMs } from '@/lib/aggregate';
import { formatClock, formatValue, timeTicks, truncateToWidth } from '@/lib/canvasUtils';
import type { DataStore } from '@/lib/dataStore';
import { writeCell } from '@/lib/heatmapColor';
import type { RafDriver } from '@/lib/rafDriver';
import type { SeriesMeta } from '@/lib/types';
import { followEdge, type PlotArea } from '@/lib/viewport';

const GUTTER_LEFT_DEFAULT = 118;
const GUTTER_LEFT_COMPACT = 76;
const NARROW_BREAKPOINT = 480;
const GUTTER_BOTTOM = 22;
const GUTTER_TOP = 8;
const GUTTER_RIGHT = 12;
const TARGET_COLS = 80;
const MAX_COLS = 300;

function readTheme(el: HTMLElement) {
  const s = getComputedStyle(el);
  return {
    bg: s.getPropertyValue('--chart-bg').trim() || '#12161c',
    grid: s.getPropertyValue('--chart-grid').trim() || '#232a34',
    text: s.getPropertyValue('--chart-label').trim() || '#8b95a5',
  };
}

interface Props {
  driver: RafDriver;
  store: DataStore;
  series: readonly SeriesMeta[];
  windowMs?: number;
  height?: number;
  rangeToken?: number;
  rangeOverrideMs?: number | null;
  aggregation?: AggregationMode;
}

/**
 * Renders a device-activity grid: one row per sensor, one column per time
 * bucket, cell colour = that sensor's mean value in that bucket normalized to
 * its own physical range. Colour is per-row-normalized rather than global,
 * because a 240 kPa pressure swing and a 2 mm/s vibration swing aren't
 * comparable numbers — each row needs its own sense of "hot."
 *
 * Cells are built into a tiny offscreen bitmap (one pixel per cell) and
 * scaled up onto the visible canvas with smoothing off. That's the standard
 * trick for this kind of grid: filling a few hundred rects by hand costs more
 * and produces seams at fractional pixel boundaries, where letting the canvas
 * scale a small exact bitmap doesn't.
 */
export function HeatmapChart({
  driver,
  store,
  series,
  windowMs = 120_000,
  height = 260,
  rangeToken = 0,
  rangeOverrideMs = null,
  aggregation = 'auto',
}: Props) {
  const areaRef = useRef<PlotArea>({ left: GUTTER_LEFT_DEFAULT, top: GUTTER_TOP, width: 0, height: 0 });
  const themeRef = useRef({ bg: '#12161c', grid: '#232a34', text: '#8b95a5' });
  const ticksRef = useRef(new Float64Array(14));

  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  if (!offscreenRef.current && typeof document !== 'undefined') {
    offscreenRef.current = document.createElement('canvas');
  }

  // Per-row scratch for bucketAggregate, reused across rows within one frame
  // — the grid itself and these temporaries are resized only when the bucket
  // count actually changes, not every frame.
  const gridRef = useRef({
    cols: 0,
    rows: 0,
    mean: new Float32Array(0),
    sum: new Float64Array(0),
    cnt: new Int32Array(0),
    min: new Float32Array(0),
    max: new Float32Array(0),
  });

  const [readout, setReadout] = useState<{ label: string; t: number; v: number; unit: string } | null>(
    null,
  );
  const readoutThrottle = useRef(0);
  const hasReadout = useRef(false);

  const initialViewport = useMemo(() => {
    const now = Date.now();
    // yMin/yMax are unused here — useChartInteraction only ever mutates
    // tMin/tMax, so reusing it for a categorical-row chart is safe as long as
    // nothing reads its y fields for anything meaningful.
    return { tMin: now - windowMs, tMax: now, yMin: 0, yMax: 1 };
  }, [windowMs]);

  const { stateRef, elementRef } = useChartInteraction(initialViewport, areaRef);

  useTimeRangeSync(stateRef, rangeToken, rangeOverrideMs, () => {
    const buf = series[0] ? store.buffer(series[0].id) : undefined;
    return buf && buf.length > 0 ? buf.timeAt(0) : null;
  });

  const draw = useCallback<Parameters<typeof useChartRenderer>[1]>(
    (ctx, size, frame, resized) => {
      const rows = series.length;
      if (rows === 0) return;

      const compact = size.width < NARROW_BREAKPOINT;
      const gutterLeft = compact ? GUTTER_LEFT_COMPACT : GUTTER_LEFT_DEFAULT;
      const labelFontPx = compact ? 10 : 11;

      const area = areaRef.current;
      area.left = gutterLeft;
      area.top = GUTTER_TOP;
      area.width = Math.max(1, size.width - gutterLeft - GUTTER_RIGHT);
      area.height = Math.max(1, size.height - GUTTER_TOP - GUTTER_BOTTOM);

      if (resized && elementRef.current) {
        themeRef.current = readTheme(elementRef.current);
      }
      const theme = themeRef.current;
      const state = stateRef.current;

      const first = store.buffer(series[0].id);
      if (first && state.following && first.length > 0) {
        state.vp = followEdge(state.vp, first.timeAt(first.length - 1));
      }
      const vp = state.vp;
      const span = vp.tMax - vp.tMin;

      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, size.width, size.height);

      const bucketMs = aggregation === 'auto' ? pickBucketMs(span, TARGET_COLS) : AGGREGATION_MS[aggregation];
      // MAX_COLS existed already as a render-cost cap; pinning a small bucket
      // (e.g. 1m) against a huge span (e.g. "All" over several hours) can now
      // hit that cap before covering the whole range — bucketAggregate simply
      // drops points past bucketCount rather than showing a stretched grid,
      // which reads as "showing the most recent portion" rather than an error.
      const cols = Math.min(MAX_COLS, Math.ceil(span / bucketMs) + 1);

      const g = gridRef.current;
      if (g.cols !== cols || g.rows !== rows) {
        g.cols = cols;
        g.rows = rows;
        g.mean = new Float32Array(cols * rows).fill(NaN);
        g.sum = new Float64Array(cols);
        g.cnt = new Int32Array(cols);
        g.min = new Float32Array(cols);
        g.max = new Float32Array(cols);
      }

      for (let r = 0; r < rows; r++) {
        const s = series[r];
        const buf = store.buffer(s.id);
        if (!buf) continue;

        const from = buf.indexAtOrAfter(vp.tMin);
        const to = buf.indexAfter(vp.tMax);
        bucketAggregate(buf, from, to, vp.tMin, bucketMs, cols, g.sum, g.cnt, g.min, g.max);

        for (let c = 0; c < cols; c++) {
          g.mean[r * cols + c] = g.cnt[c] > 0 ? g.sum[c] / g.cnt[c] : NaN;
        }
      }

      const off = offscreenRef.current;
      if (off) {
        if (off.width !== cols || off.height !== rows) {
          off.width = cols;
          off.height = rows;
        }
        const octx = off.getContext('2d', { alpha: false });
        if (octx) {
          const img = octx.createImageData(cols, rows);
          for (let r = 0; r < rows; r++) {
            const s = series[r];
            const range = s.max - s.min || 1;
            for (let c = 0; c < cols; c++) {
              const raw = g.mean[r * cols + c];
              const t = Number.isNaN(raw) ? NaN : (raw - s.min) / range;
              writeCell(img.data, cols, c, r, t, [0x1a, 0x20, 0x29]);
            }
          }
          octx.putImageData(img, 0, 0);

          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(off, 0, 0, cols, rows, area.left, area.top, area.width, area.height);
        }
      }

      // Row separators and labels — cheap at 6-8 rows, drawn every frame
      // alongside everything else rather than kept in sync via a second path.
      const rowHeight = area.height / rows;
      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 1;
      ctx.font = `${labelFontPx}px ui-sans-serif, system-ui`;
      ctx.fillStyle = theme.text;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      for (let r = 0; r <= rows; r++) {
        const y = area.top + r * rowHeight;
        ctx.beginPath();
        ctx.moveTo(area.left, y);
        ctx.lineTo(area.left + area.width, y);
        ctx.stroke();
        if (r < rows) {
          const label = truncateToWidth(ctx, series[r].label, gutterLeft - 16);
          ctx.fillText(label, area.left - 8, y + rowHeight / 2);
        }
      }

      const nx = timeTicks(vp.tMin, vp.tMax, 6, ticksRef.current);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (let i = 0; i < nx; i++) {
        const x = area.left + ((ticksRef.current[i] - vp.tMin) / span) * area.width;
        ctx.fillText(formatClock(ticksRef.current[i]), x, area.top + area.height + 6);
      }

      if (
        state.hoverX >= area.left &&
        state.hoverX <= area.left + area.width &&
        state.hoverY >= area.top &&
        state.hoverY <= area.top + area.height
      ) {
        const row = Math.min(rows - 1, Math.floor((state.hoverY - area.top) / rowHeight));
        const col = Math.min(cols - 1, Math.floor(((state.hoverX - area.left) / area.width) * cols));

        if (frame.now - readoutThrottle.current > 160) {
          readoutThrottle.current = frame.now;
          const v = g.mean[row * cols + col];
          const s = series[row];
          hasReadout.current = !Number.isNaN(v);
          setReadout(
            Number.isNaN(v)
              ? null
              : { label: s.label, t: vp.tMin + col * bucketMs, v, unit: s.unit },
          );
        }
      } else if (hasReadout.current && frame.now - readoutThrottle.current > 160) {
        readoutThrottle.current = frame.now;
        hasReadout.current = false;
        setReadout(null);
      }
    },
    [store, series, aggregation, elementRef, stateRef],
  );

  const { canvasRef } = useChartRenderer(driver, draw);

  return (
    <figure className="chart" style={{ height }}>
      <figcaption className="chart-head">
        <span className="chart-title">Sensor activity</span>
        <span className="chart-readout">
          {readout
            ? `${readout.label}: ${formatValue(readout.v, 100)} ${readout.unit} @ ${formatClock(readout.t)}`
            : 'hover a cell'}
        </span>
      </figcaption>

      <div className="chart-body" ref={elementRef}>
        <canvas ref={canvasRef} />
      </div>
    </figure>
  );
}
