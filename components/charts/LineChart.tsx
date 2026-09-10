'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { AxisLayer, type AxisHandle } from './AxisLayer';
import { useChartInteraction } from '@/hooks/useChartInteraction';
import { useChartRenderer } from '@/hooks/useChartRenderer';
import { crisp, niceTicks, timeTicks } from '@/lib/canvasUtils';
import { lttbDecimate, minMaxDecimate, scratchSize, strokePath, type Decimation } from '@/lib/decimate';
import type { DataStore } from '@/lib/dataStore';
import type { RafDriver } from '@/lib/rafDriver';
import type { SeriesMeta } from '@/lib/types';
import { followEdge, settleY, type PlotArea } from '@/lib/viewport';

const GUTTER_LEFT = 52;
const GUTTER_BOTTOM = 24;
const GUTTER_TOP = 10;
const GUTTER_RIGHT = 12;

interface Props {
  driver: RafDriver;
  store: DataStore;
  series: SeriesMeta;
  windowMs?: number;
  decimation?: Decimation;
  height?: number;
}

/** Canvas can't read CSS custom properties, so they're resolved on resize. */
function readTheme(el: HTMLElement) {
  const s = getComputedStyle(el);
  return {
    bg: s.getPropertyValue('--chart-bg').trim() || '#12161c',
    grid: s.getPropertyValue('--chart-grid').trim() || '#232a34',
    crosshair: s.getPropertyValue('--chart-crosshair').trim() || '#5a6472',
  };
}

export function LineChart({
  driver,
  store,
  series,
  windowMs = 60_000,
  decimation = 'minmax',
  height = 240,
}: Props) {
  const axisRef = useRef<AxisHandle | null>(null);
  const areaRef = useRef<PlotArea>({ left: GUTTER_LEFT, top: GUTTER_TOP, width: 0, height: 0 });
  const themeRef = useRef({ bg: '#12161c', grid: '#232a34', crosshair: '#5a6472' });
  const scratchRef = useRef(new Float32Array(scratchSize(1200)));
  const extentRef = useRef(new Float32Array(2));
  const ticksRef = useRef(new Float64Array(14));

  const [readout, setReadout] = useState<{ t: number; v: number } | null>(null);
  const readoutThrottle = useRef(0);
  // Mirrors `readout` so the draw callback can test it without listing it as a
  // dependency and being rebuilt every time the pointer moves.
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
        const need = scratchSize(area.width);
        if (scratchRef.current.length < need) scratchRef.current = new Float32Array(need);
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

      // Gridlines are drawn here rather than in the SVG layer so they move in
      // the same frame as the data. Split across the two layers they desync
      // visibly whenever the SVG update is throttled.
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
        const x = crisp(area.left + ((ticksRef.current[i] - vp.tMin) / (vp.tMax - vp.tMin)) * area.width);
        ctx.moveTo(x, area.top);
        ctx.lineTo(x, area.top + area.height);
      }
      ctx.stroke();

      const scratch = scratchRef.current;
      const count =
        decimation === 'lttb'
          ? lttbDecimate(buf, from, to, Math.floor(area.width), vp, area, scratch)
          : minMaxDecimate(buf, from, to, vp, area, scratch);

      ctx.save();
      ctx.beginPath();
      ctx.rect(area.left, area.top, area.width, area.height);
      ctx.clip();
      strokePath(ctx, scratch, count, series.colour);
      ctx.restore();

      if (state.hoverX >= area.left && state.hoverX <= area.left + area.width) {
        const x = crisp(state.hoverX);
        ctx.strokeStyle = theme.crosshair;
        ctx.beginPath();
        ctx.moveTo(x, area.top);
        ctx.lineTo(x, area.top + area.height);
        ctx.stroke();

        // The numeric readout is the one thing here that has to reach React.
        // Six updates a second is past the point anyone can read it changing.
        if (frame.now - readoutThrottle.current > 160) {
          readoutThrottle.current = frame.now;
          const t = vp.tMin + ((state.hoverX - area.left) / area.width) * (vp.tMax - vp.tMin);
          const idx = buf.indexAtOrAfter(t);
          const clamped = Math.min(buf.length - 1, Math.max(0, idx));
          hasReadout.current = buf.length > 0;
          setReadout(
            buf.length > 0 ? { t: buf.timeAt(clamped), v: buf.valueAt(clamped) } : null,
          );
        }
      } else if (hasReadout.current && frame.now - readoutThrottle.current > 160) {
        readoutThrottle.current = frame.now;
        hasReadout.current = false;
        setReadout(null);
      }

      axisRef.current?.update(vp, area);
    },
    [store, series.id, series.colour, decimation, elementRef, stateRef],
  );

  const { canvasRef } = useChartRenderer(driver, draw);

  return (
    <figure className="chart" style={{ height }}>
      <figcaption className="chart-head">
        <span className="chart-title" style={{ borderColor: series.colour }}>
          {series.label}
        </span>
        <span className="chart-readout">
          {readout ? `${readout.v.toFixed(2)} ${series.unit}` : `— ${series.unit}`}
        </span>
      </figcaption>

      <div className="chart-body" ref={elementRef}>
        <canvas ref={canvasRef} />
        <AxisLayer ref={axisRef} className="chart-axis" />
      </div>
    </figure>
  );
}
