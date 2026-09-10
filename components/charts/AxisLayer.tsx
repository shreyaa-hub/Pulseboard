'use client';

import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { formatClock, formatValue, niceTicks, timeTicks } from '@/lib/canvasUtils';
import type { Viewport } from '@/lib/types';
import type { PlotArea } from '@/lib/viewport';

const MAX_TICKS = 14;

export interface AxisHandle {
  update(vp: Viewport, area: PlotArea): void;
}

/**
 * Axis labels in SVG, positioned imperatively.
 *
 * The obvious version — viewport in React state, labels re-rendered from it —
 * either reconciles this subtree 60 times a second, or gets throttled and then
 * the labels visibly lag the gridlines drawn on the canvas beside them. So the
 * elements are pooled once and the rAF loop writes their positions and text
 * directly. React renders this component once; after that it is 30-odd DOM
 * writes per frame, which is nothing.
 */
export const AxisLayer = forwardRef<AxisHandle, { className?: string; xMode?: 'time' | 'value' }>(
  function AxisLayer({ className, xMode = 'time' }, ref) {
  const xLines = useRef<(SVGLineElement | null)[]>([]);
  const xLabels = useRef<(SVGTextElement | null)[]>([]);
  const yLines = useRef<(SVGLineElement | null)[]>([]);
  const yLabels = useRef<(SVGTextElement | null)[]>([]);

  const scratch = useMemo(() => new Float64Array(MAX_TICKS), []);
  const slots = useMemo(() => Array.from({ length: MAX_TICKS }, (_, i) => i), []);

  useImperativeHandle(
    ref,
    () => ({
      update(vp: Viewport, area: PlotArea) {
        const bottom = area.top + area.height;

        const nx =
          xMode === 'time'
            ? timeTicks(vp.tMin, vp.tMax, 6, scratch)
            : niceTicks(vp.tMin, vp.tMax, 6, scratch);
        const xSpan = vp.tMax - vp.tMin;
        for (let i = 0; i < MAX_TICKS; i++) {
          const line = xLines.current[i];
          const label = xLabels.current[i];
          if (!line || !label) continue;

          if (i >= nx) {
            line.style.display = 'none';
            label.style.display = 'none';
            continue;
          }

          const x = area.left + ((scratch[i] - vp.tMin) / xSpan) * area.width;
          line.style.display = '';
          label.style.display = '';
          line.setAttribute('x1', String(x));
          line.setAttribute('x2', String(x));
          line.setAttribute('y1', String(bottom));
          line.setAttribute('y2', String(bottom + 4));
          label.setAttribute('x', String(x));
          label.setAttribute('y', String(bottom + 17));
          label.textContent =
            xMode === 'time' ? formatClock(scratch[i]) : formatValue(scratch[i], xSpan);
        }

        const ny = niceTicks(vp.yMin, vp.yMax, 5, scratch);
        const ySpan = vp.yMax - vp.yMin;
        for (let i = 0; i < MAX_TICKS; i++) {
          const line = yLines.current[i];
          const label = yLabels.current[i];
          if (!line || !label) continue;

          if (i >= ny) {
            line.style.display = 'none';
            label.style.display = 'none';
            continue;
          }

          const y = area.top + area.height - ((scratch[i] - vp.yMin) / ySpan) * area.height;
          line.style.display = '';
          label.style.display = '';
          line.setAttribute('x1', String(area.left - 4));
          line.setAttribute('x2', String(area.left));
          line.setAttribute('y1', String(y));
          line.setAttribute('y2', String(y));
          label.setAttribute('x', String(area.left - 8));
          label.setAttribute('y', String(y + 4));
          label.textContent = formatValue(scratch[i], ySpan);
        }
      },
    }),
    [scratch, xMode],
  );

  return (
    <svg className={className} aria-hidden="true">
      <g className="axis-x">
        {slots.map((i) => (
          <line
            key={`xl${i}`}
            ref={(el) => {
              xLines.current[i] = el;
            }}
            style={{ display: 'none' }}
          />
        ))}
        {slots.map((i) => (
          <text
            key={`xt${i}`}
            textAnchor="middle"
            ref={(el) => {
              xLabels.current[i] = el;
            }}
            style={{ display: 'none' }}
          />
        ))}
      </g>
      <g className="axis-y">
        {slots.map((i) => (
          <line
            key={`yl${i}`}
            ref={(el) => {
              yLines.current[i] = el;
            }}
            style={{ display: 'none' }}
          />
        ))}
        {slots.map((i) => (
          <text
            key={`yt${i}`}
            textAnchor="end"
            ref={(el) => {
              yLabels.current[i] = el;
            }}
            style={{ display: 'none' }}
          />
        ))}
      </g>
    </svg>
  );
});
