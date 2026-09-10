'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { AxisLayer, type AxisHandle } from './AxisLayer';
import { useChartRenderer } from '@/hooks/useChartRenderer';
import { useScatterInteraction, type ScatterDomain } from '@/hooks/useScatterInteraction';
import { crisp, niceTicks } from '@/lib/canvasUtils';
import type { DataStore } from '@/lib/dataStore';
import type { RafDriver } from '@/lib/rafDriver';
import type { SeriesMeta } from '@/lib/types';
import type { PlotArea } from '@/lib/viewport';

const GUTTER_LEFT = 52;
const GUTTER_BOTTOM = 24;
const GUTTER_TOP = 10;
const GUTTER_RIGHT = 12;
const DOT = 3;

/** Above this many points in the window, draw every Nth instead of all of
 *  them. Min/max decimation (as used by the line chart) has no equivalent
 *  here — there's no "envelope" of an unordered x/y relationship — so this
 *  falls back to uniform stride sampling, which is the standard approach for
 *  scatter plots at this scale and keeps the pattern visually representative
 *  without secretly hiding clusters. */
const MAX_DRAWN = 4000;

function readTheme(el: HTMLElement) {
  const s = getComputedStyle(el);
  return {
    bg: s.getPropertyValue('--chart-bg').trim() || '#12161c',
    grid: s.getPropertyValue('--chart-grid').trim() || '#232a34',
    crosshair: s.getPropertyValue('--chart-crosshair').trim() || '#5a6472',
  };
}

interface Props {
  driver: RafDriver;
  store: DataStore;
  xSeries: SeriesMeta;
  ySeries: SeriesMeta;
  windowMs?: number;
  height?: number;
}

export function ScatterChart({
  driver,
  store,
  xSeries,
  ySeries,
  windowMs = 60_000,
  height = 240,
}: Props) {
  const axisRef = useRef<AxisHandle | null>(null);
  const areaRef = useRef<PlotArea>({ left: GUTTER_LEFT, top: GUTTER_TOP, width: 0, height: 0 });
  const themeRef = useRef({ bg: '#12161c', grid: '#232a34', crosshair: '#5a6472' });
  const ticksRef = useRef(new Float64Array(14));

  const [readout, setReadout] = useState<{ x: number; y: number } | null>(null);
  const readoutThrottle = useRef(0);
  const hasReadout = useRef(false);

  const initialDomain = useMemo<ScatterDomain>(
    () => ({ xMin: xSeries.min, xMax: xSeries.max, yMin: ySeries.min, yMax: ySeries.max }),
    [xSeries.min, xSeries.max, ySeries.min, ySeries.max],
  );

  const { stateRef, elementRef } = useScatterInteraction(initialDomain, areaRef);

  const draw = useCallback<Parameters<typeof useChartRenderer>[1]>(
    (ctx, size, frame, resized) => {
      const xBuf = store.buffer(xSeries.id);
      const yBuf = store.buffer(ySeries.id);
      if (!xBuf || !yBuf) return;

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
      const { domain } = state;

      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, size.width, size.height);

      // The two buffers tick in lockstep (verified: every ingest pushes a
      // batch to all series at once), so index i means the same instant in
      // both — no separate time lookup is needed to pair them up.
      const now = Date.now();
      const cutoff = now - windowMs;
      let from = xBuf.indexAtOrAfter(cutoff);
      const to = xBuf.length;
      const count = to - from;

      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const nx = niceTicks(domain.xMin, domain.xMax, 6, ticksRef.current);
      for (let i = 0; i < nx; i++) {
        const x = crisp(
          area.left + ((ticksRef.current[i] - domain.xMin) / (domain.xMax - domain.xMin)) * area.width,
        );
        ctx.moveTo(x, area.top);
        ctx.lineTo(x, area.top + area.height);
      }
      const ny = niceTicks(domain.yMin, domain.yMax, 5, ticksRef.current);
      for (let i = 0; i < ny; i++) {
        const y = crisp(
          area.top + area.height - ((ticksRef.current[i] - domain.yMin) / (domain.yMax - domain.yMin)) * area.height,
        );
        ctx.moveTo(area.left, y);
        ctx.lineTo(area.left + area.width, y);
      }
      ctx.stroke();

      if (count > 0) {
        const stride = count > MAX_DRAWN ? Math.ceil(count / MAX_DRAWN) : 1;
        const xScale = area.width / (domain.xMax - domain.xMin);
        const yScale = area.height / (domain.yMax - domain.yMin);
        const yBase = area.top + area.height;

        ctx.save();
        ctx.beginPath();
        ctx.rect(area.left, area.top, area.width, area.height);
        ctx.clip();

        for (let i = from; i < to; i += stride) {
          const xv = xBuf.valueAt(i);
          const yv = yBuf.valueAt(i);
          const px = area.left + (xv - domain.xMin) * xScale;
          const py = yBase - (yv - domain.yMin) * yScale;
          if (px < area.left - DOT || px > area.left + area.width + DOT) continue;
          if (py < area.top - DOT || py > yBase + DOT) continue;

          const status = Math.max(xBuf.statusAt(i), yBuf.statusAt(i));
          ctx.fillStyle = status === 2 ? '#ef6f8b' : status === 1 ? '#e0b83c' : xSeries.colour;
          ctx.globalAlpha = status === 0 ? 0.55 : 0.9;
          ctx.fillRect(px - DOT / 2, py - DOT / 2, DOT, DOT);
        }
        ctx.globalAlpha = 1;
        ctx.restore();
      }

      if (
        state.hoverX >= area.left &&
        state.hoverX <= area.left + area.width &&
        state.hoverY >= area.top &&
        state.hoverY <= area.top + area.height
      ) {
        const cx = crisp(state.hoverX);
        const cy = crisp(state.hoverY);
        ctx.strokeStyle = theme.crosshair;
        ctx.beginPath();
        ctx.moveTo(cx, area.top);
        ctx.lineTo(cx, area.top + area.height);
        ctx.moveTo(area.left, cy);
        ctx.lineTo(area.left + area.width, cy);
        ctx.stroke();

        if (frame.now - readoutThrottle.current > 160) {
          readoutThrottle.current = frame.now;
          const xv = domain.xMin + ((state.hoverX - area.left) / area.width) * (domain.xMax - domain.xMin);
          const yv =
            domain.yMin + ((area.top + area.height - state.hoverY) / area.height) * (domain.yMax - domain.yMin);
          hasReadout.current = true;
          setReadout({ x: xv, y: yv });
        }
      } else if (hasReadout.current && frame.now - readoutThrottle.current > 160) {
        readoutThrottle.current = frame.now;
        hasReadout.current = false;
        setReadout(null);
      }

      axisRef.current?.update(
        { tMin: domain.xMin, tMax: domain.xMax, yMin: domain.yMin, yMax: domain.yMax },
        area,
      );
    },
    [store, xSeries.id, xSeries.colour, ySeries.id, windowMs, elementRef, stateRef],
  );

  const { canvasRef } = useChartRenderer(driver, draw);

  return (
    <figure className="chart" style={{ height }}>
      <figcaption className="chart-head">
        <span className="chart-title" style={{ borderColor: xSeries.colour }}>
          {ySeries.label} vs {xSeries.label}
        </span>
        <span className="chart-readout">
          {readout
            ? `${readout.x.toFixed(1)} ${xSeries.unit}, ${readout.y.toFixed(1)} ${ySeries.unit}`
            : `${xSeries.unit} / ${ySeries.unit}`}
        </span>
      </figcaption>

      <div className="chart-body" ref={elementRef}>
        <canvas ref={canvasRef} />
        <AxisLayer ref={axisRef} className="chart-axis" xMode="value" />
      </div>
    </figure>
  );
}
