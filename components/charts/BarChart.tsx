'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { AxisLayer, type AxisHandle } from './AxisLayer';
import { useChartInteraction } from '@/hooks/useChartInteraction';
import { useChartRenderer } from '@/hooks/useChartRenderer';
import { bucketAggregate, pickBucketMs } from '@/lib/aggregate';
import { crisp, niceTicks, timeTicks } from '@/lib/canvasUtils';
import type { DataStore } from '@/lib/dataStore';
import type { RafDriver } from '@/lib/rafDriver';
import type { SeriesMeta } from '@/lib/types';
import { followEdge, settleY, type PlotArea } from '@/lib/viewport';

const GUTTER_LEFT = 52;
const GUTTER_BOTTOM = 24;
const GUTTER_TOP = 10;
const GUTTER_RIGHT = 12;

/** Target number of bars visible across the plot. Wider bars read better than
 *  more bars, so this stays modest rather than one bar per pixel. */
const TARGET_BARS = 48;
const BAR_GAP_FRACTION = 0.22;

interface Props {
  driver: RafDriver;
  store: DataStore;
  series: SeriesMeta;
  windowMs?: number;
  height?: number;
}

function readTheme(el: HTMLElement) {
  const s = getComputedStyle(el);
  return {
    bg: s.getPropertyValue('--chart-bg').trim() || '#12161c',
    grid: s.getPropertyValue('--chart-grid').trim() || '#232a34',
    crosshair: s.getPropertyValue('--chart-crosshair').trim() || '#5a6472',
  };
}

/**
 * Draws the mean value per time bucket rather than any raw point. A raw
 * bar-per-tick at 10/second would be several hundred slivers a second — not
 * readable and not what a bar chart is for. Bucketing here is the same
 * aggregation the spec asks for elsewhere (1m/5m/1h grouping), just picked
 * automatically from the current zoom level instead of a fixed dropdown.
 */
export function BarChart({ driver, store, series, windowMs = 120_000, height = 240 }: Props) {
  const axisRef = useRef<AxisHandle | null>(null);
  const areaRef = useRef<PlotArea>({ left: GUTTER_LEFT, top: GUTTER_TOP, width: 0, height: 0 });
  const themeRef = useRef({ bg: '#12161c', grid: '#232a34', crosshair: '#5a6472' });
  const extentRef = useRef(new Float32Array(2));
  const ticksRef = useRef(new Float64Array(14));

  // Bucket scratch is resized only when the bucket count actually changes, not
  // every frame — reallocating four typed arrays 60 times a second for a
  // count that is usually stable would be pure waste.
  const bucketsRef = useRef({
    cap: 0,
    sum: new Float64Array(0),
    cnt: new Int32Array(0),
    min: new Float32Array(0),
    max: new Float32Array(0),
  });

  const [readout, setReadout] = useState<{ t: number; v: number; n: number } | null>(null);
  const readoutThrottle = useRef(0);
  const hasReadout = useRef(false);

  const initialViewport = useMemo(() => {
    const now = Date.now();
    return { tMin: now - windowMs, tMax: now, yMin: series.min, yMax: series.max };
  }, [windowMs, series.min, series.max]);

  const { stateRef, elementRef } = useChartInteraction(initialViewport, areaRef);

  const draw = useCallback<Parameters<typeof useChartRenderer>[1]>(
    (ctx, size, frame, resized) => {
      const buf = store.buffer(series.id);
      if (!buf) return;

      const area = areaRef.current;
      area.left = GUTTER_LEFT;
      area.top = GUTTER_TOP;
      area.width = Math.max(1, size.width - GUTTER_LEFT - GUTTER_RIGHT);
      area.height = Math.max(1, size.height - GUTTER_TOP - GUTTER_BOTTOM);

      if (resized && elementRef.current) {
        themeRef.current = readTheme(elementRef.current);
      }

      const theme = themeRef.current;
      const state = stateRef.current;

      if (state.following && buf.length > 0) {
        state.vp = followEdge(state.vp, buf.timeAt(buf.length - 1));
      }

      const from = buf.indexAtOrAfter(state.vp.tMin);
      const to = buf.indexAfter(state.vp.tMax);

      if (buf.extent(from, to, extentRef.current)) {
        state.vp = settleY(state.vp, extentRef.current[0], extentRef.current[1]);
      }
      const vp = state.vp;

      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, size.width, size.height);

      const span = vp.tMax - vp.tMin;
      const bucketMs = pickBucketMs(span, TARGET_BARS);
      const bucketCount = Math.min(500, Math.ceil(span / bucketMs) + 1);

      const b = bucketsRef.current;
      if (b.cap < bucketCount) {
        b.cap = bucketCount;
        b.sum = new Float64Array(bucketCount);
        b.cnt = new Int32Array(bucketCount);
        b.min = new Float32Array(bucketCount);
        b.max = new Float32Array(bucketCount);
      }

      bucketAggregate(buf, from, to, vp.tMin, bucketMs, bucketCount, b.sum, b.cnt, b.min, b.max);

      // Gridlines share the canvas with the bars for the same reason as
      // LineChart: drawn separately in SVG they visibly lag on every zoom.
      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const ny = niceTicks(vp.yMin, vp.yMax, 5, ticksRef.current);
      for (let i = 0; i < ny; i++) {
        const y = crisp(
          area.top + area.height - ((ticksRef.current[i] - vp.yMin) / (vp.yMax - vp.yMin)) * area.height,
        );
        ctx.moveTo(area.left, y);
        ctx.lineTo(area.left + area.width, y);
      }
      const nx = timeTicks(vp.tMin, vp.tMax, 6, ticksRef.current);
      for (let i = 0; i < nx; i++) {
        const x = crisp(area.left + ((ticksRef.current[i] - vp.tMin) / span) * area.width);
        ctx.moveTo(x, area.top);
        ctx.lineTo(x, area.top + area.height);
      }
      ctx.stroke();

      const yBase = area.top + area.height;
      const yScale = area.height / (vp.yMax - vp.yMin);
      const pxPerBucket = (bucketMs / span) * area.width;
      const barWidth = Math.max(1, pxPerBucket * (1 - BAR_GAP_FRACTION));

      ctx.save();
      ctx.beginPath();
      ctx.rect(area.left, area.top, area.width, area.height);
      ctx.clip();
      ctx.fillStyle = series.colour;

      for (let i = 0; i < bucketCount; i++) {
        if (b.cnt[i] === 0) continue;
        const bucketStart = vp.tMin + i * bucketMs;
        const x = area.left + ((bucketStart - vp.tMin) / span) * area.width;
        const mean = b.sum[i] / b.cnt[i];
        const barHeight = Math.max(1, (mean - vp.yMin) * yScale);
        ctx.fillRect(x, yBase - barHeight, barWidth, barHeight);
      }
      ctx.restore();

      if (state.hoverX >= area.left && state.hoverX <= area.left + area.width) {
        const x = crisp(state.hoverX);
        ctx.strokeStyle = theme.crosshair;
        ctx.beginPath();
        ctx.moveTo(x, area.top);
        ctx.lineTo(x, area.top + area.height);
        ctx.stroke();

        if (frame.now - readoutThrottle.current > 160) {
          readoutThrottle.current = frame.now;
          const t = vp.tMin + ((state.hoverX - area.left) / area.width) * span;
          let idx = Math.floor((t - vp.tMin) / bucketMs);
          if (idx < 0) idx = 0;
          else if (idx >= bucketCount) idx = bucketCount - 1;

          hasReadout.current = b.cnt[idx] > 0;
          setReadout(
            b.cnt[idx] > 0
              ? { t: vp.tMin + idx * bucketMs, v: b.sum[idx] / b.cnt[idx], n: b.cnt[idx] }
              : null,
          );
        }
      } else if (hasReadout.current && frame.now - readoutThrottle.current > 160) {
        readoutThrottle.current = frame.now;
        hasReadout.current = false;
        setReadout(null);
      }

      axisRef.current?.update(vp, area);
    },
    [store, series.id, series.colour, elementRef, stateRef],
  );

  const { canvasRef } = useChartRenderer(driver, draw);

  return (
    <figure className="chart" style={{ height }}>
      <figcaption className="chart-head">
        <span className="chart-title" style={{ borderColor: series.colour }}>
          {series.label} (avg)
        </span>
        <span className="chart-readout">
          {readout ? `${readout.v.toFixed(2)} ${series.unit} · n=${readout.n}` : `— ${series.unit}`}
        </span>
      </figcaption>

      <div className="chart-body" ref={elementRef}>
        <canvas ref={canvasRef} />
        <AxisLayer ref={axisRef} className="chart-axis" />
      </div>
    </figure>
  );
}
