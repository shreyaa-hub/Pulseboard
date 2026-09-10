import type { Viewport } from './types';

export interface PlotArea {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The viewport lives in data space (timestamps and values), not as a canvas
 * transform. Two reasons: decimation has to know how many data points fall in
 * one pixel column, which is only answerable in data space; and zooming a
 * canvas transform scales the stroke width and the text along with the data.
 */
export function timeToX(t: number, vp: Viewport, area: PlotArea): number {
  return area.left + ((t - vp.tMin) / (vp.tMax - vp.tMin)) * area.width;
}

export function valueToY(v: number, vp: Viewport, area: PlotArea): number {
  return area.top + area.height - ((v - vp.yMin) / (vp.yMax - vp.yMin)) * area.height;
}

export function xToTime(x: number, vp: Viewport, area: PlotArea): number {
  return vp.tMin + ((x - area.left) / area.width) * (vp.tMax - vp.tMin);
}

export function yToValue(y: number, vp: Viewport, area: PlotArea): number {
  return vp.yMin + ((area.top + area.height - y) / area.height) * (vp.yMax - vp.yMin);
}

/** Milliseconds of data covered by one horizontal pixel. */
export function msPerPixel(vp: Viewport, area: PlotArea): number {
  return (vp.tMax - vp.tMin) / area.width;
}

export const MIN_SPAN_MS = 500;
export const MAX_SPAN_MS = 24 * 3600_000;

/**
 * Zooms about a fixed point so the timestamp under the cursor stays under the
 * cursor. `anchor` is 0..1 across the plot width.
 */
export function zoomTime(vp: Viewport, factor: number, anchor: number): Viewport {
  const span = vp.tMax - vp.tMin;
  let next = span * factor;
  if (next < MIN_SPAN_MS) next = MIN_SPAN_MS;
  else if (next > MAX_SPAN_MS) next = MAX_SPAN_MS;

  const pivot = vp.tMin + span * anchor;
  return {
    ...vp,
    tMin: pivot - next * anchor,
    tMax: pivot + next * (1 - anchor),
  };
}

export function panTime(vp: Viewport, deltaMs: number): Viewport {
  return { ...vp, tMin: vp.tMin + deltaMs, tMax: vp.tMax + deltaMs };
}

/**
 * Slides the window to end at `newest` while keeping its width. Called every
 * frame while the chart is following the live edge; the moment the user pans
 * or zooms, following is switched off and this stops being called.
 */
export function followEdge(vp: Viewport, newest: number): Viewport {
  const span = vp.tMax - vp.tMin;
  if (vp.tMax === newest) return vp;
  return { ...vp, tMin: newest - span, tMax: newest };
}

/**
 * Expands a measured min/max into a padded, slightly sticky range. Recomputing
 * the y-axis from scratch every frame makes the whole chart jitter as points
 * enter and leave the window, so the range only moves when the data leaves a
 * dead band around it.
 */
export function settleY(vp: Viewport, dataMin: number, dataMax: number): Viewport {
  if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax)) return vp;

  let lo = dataMin;
  let hi = dataMax;
  if (hi - lo < 1e-9) {
    lo -= 0.5;
    hi += 0.5;
  }
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;

  const currentSpan = vp.yMax - vp.yMin;
  const inside = lo >= vp.yMin && hi <= vp.yMax;
  const roomy = hi - lo > currentSpan * 0.6;
  if (inside && roomy) return vp;

  return { ...vp, yMin: lo, yMax: hi };
}
