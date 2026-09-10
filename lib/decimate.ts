import type { SeriesBuffer } from './ringBuffer';
import type { Viewport } from './types';
import type { PlotArea } from './viewport';

export type Decimation = 'minmax' | 'lttb' | 'none';

/**
 * Both algorithms write interleaved x,y pixel coordinates into a caller-owned
 * Float32Array and return the number of points written. Nothing is allocated
 * per frame, and the coordinates are small numbers so Float32 is safe — which
 * it would not be for raw epoch timestamps, where float32 granularity at
 * 1.7e12 is about two minutes.
 */

/** Float32 pairs needed for a plot this wide. Size your scratch buffer with this. */
export function scratchSize(plotWidth: number): number {
  return Math.ceil(plotWidth + 2) * 4;
}

/**
 * Min/max decimation: one vertical span per pixel column. Visually lossless
 * for a line chart — every spike survives, because a spike is by definition
 * the min or max of its column — while collapsing 100k points into at most
 * 2 per column.
 *
 * Emitting min before max (or max before min) according to which occurred
 * first keeps the polyline direction honest, so the trace doesn't develop a
 * sawtooth that isn't in the data.
 */
export function minMaxDecimate(
  buf: SeriesBuffer,
  from: number,
  to: number,
  vp: Viewport,
  area: PlotArea,
  out: Float32Array,
): number {
  const n = to - from;
  if (n <= 0) return 0;

  const tSpan = vp.tMax - vp.tMin;
  const ySpan = vp.yMax - vp.yMin;
  if (tSpan <= 0 || ySpan <= 0) return 0;

  const xScale = area.width / tSpan;
  const yScale = area.height / ySpan;
  const yBase = area.top + area.height;

  let written = 0;
  let i = from;
  let col = Math.floor((buf.timeAt(i) - vp.tMin) * xScale);

  let lo = Infinity;
  let hi = -Infinity;
  let loIdx = i;
  let hiIdx = i;

  while (i < to) {
    const t = buf.timeAt(i);
    const c = Math.floor((t - vp.tMin) * xScale);

    if (c !== col) {
      written = flushColumn(buf, lo, hi, loIdx, hiIdx, vp, area, xScale, yScale, yBase, out, written);
      if (written + 4 > out.length) return written;
      col = c;
      lo = Infinity;
      hi = -Infinity;
    }

    const v = buf.valueAt(i);
    if (v < lo) {
      lo = v;
      loIdx = i;
    }
    if (v > hi) {
      hi = v;
      hiIdx = i;
    }
    i++;
  }

  return flushColumn(buf, lo, hi, loIdx, hiIdx, vp, area, xScale, yScale, yBase, out, written);
}

function flushColumn(
  buf: SeriesBuffer,
  lo: number,
  hi: number,
  loIdx: number,
  hiIdx: number,
  vp: Viewport,
  area: PlotArea,
  xScale: number,
  yScale: number,
  yBase: number,
  out: Float32Array,
  written: number,
): number {
  if (lo === Infinity) return written;

  const firstIsLow = loIdx <= hiIdx;
  const aIdx = firstIsLow ? loIdx : hiIdx;
  const bIdx = firstIsLow ? hiIdx : loIdx;
  const aVal = firstIsLow ? lo : hi;
  const bVal = firstIsLow ? hi : lo;

  out[written++] = area.left + (buf.timeAt(aIdx) - vp.tMin) * xScale;
  out[written++] = yBase - (aVal - vp.yMin) * yScale;

  if (aIdx !== bIdx) {
    out[written++] = area.left + (buf.timeAt(bIdx) - vp.tMin) * xScale;
    out[written++] = yBase - (bVal - vp.yMin) * yScale;
  }
  return written;
}

/**
 * Largest Triangle Three Buckets. Picks one representative per bucket by
 * maximising the triangle area it forms with the previous kept point and the
 * next bucket's average, which preserves the eye-level shape of a curve much
 * better than nth-point sampling.
 *
 * Slower than min/max and it can miss a single-sample spike, so min/max stays
 * the default. Offered as a toggle because the difference between the two is
 * the clearest way to show what decimation is actually doing.
 */
export function lttbDecimate(
  buf: SeriesBuffer,
  from: number,
  to: number,
  threshold: number,
  vp: Viewport,
  area: PlotArea,
  out: Float32Array,
): number {
  const n = to - from;
  if (n <= 0) return 0;

  const tSpan = vp.tMax - vp.tMin;
  const ySpan = vp.yMax - vp.yMin;
  if (tSpan <= 0 || ySpan <= 0) return 0;

  const xScale = area.width / tSpan;
  const yScale = area.height / ySpan;
  const yBase = area.top + area.height;
  const px = (i: number) => area.left + (buf.timeAt(i) - vp.tMin) * xScale;
  const py = (i: number) => yBase - (buf.valueAt(i) - vp.yMin) * yScale;

  const cap = Math.min(threshold, Math.floor(out.length / 2));
  if (n <= cap || cap < 3) {
    let w = 0;
    for (let i = from; i < to && w + 2 <= out.length; i++) {
      out[w++] = px(i);
      out[w++] = py(i);
    }
    return w;
  }

  const every = (n - 2) / (cap - 2);
  let written = 0;
  let a = from;

  out[written++] = px(a);
  out[written++] = py(a);

  for (let i = 0; i < cap - 2; i++) {
    // Average of the next bucket, used as the triangle's third vertex.
    let avgStart = from + Math.floor((i + 1) * every) + 1;
    let avgEnd = from + Math.floor((i + 2) * every) + 1;
    if (avgEnd > to) avgEnd = to;
    if (avgStart >= avgEnd) avgStart = avgEnd - 1;

    let avgX = 0;
    let avgY = 0;
    for (let j = avgStart; j < avgEnd; j++) {
      avgX += px(j);
      avgY += py(j);
    }
    const count = avgEnd - avgStart;
    avgX /= count;
    avgY /= count;

    const rangeStart = from + Math.floor(i * every) + 1;
    const rangeEnd = Math.min(from + Math.floor((i + 1) * every) + 1, to);

    const ax = px(a);
    const ay = py(a);

    let best = rangeStart;
    let bestArea = -1;
    for (let j = rangeStart; j < rangeEnd; j++) {
      const area2 = Math.abs((ax - avgX) * (py(j) - ay) - (ax - px(j)) * (avgY - ay));
      if (area2 > bestArea) {
        bestArea = area2;
        best = j;
      }
    }

    out[written++] = px(best);
    out[written++] = py(best);
    a = best;
  }

  out[written++] = px(to - 1);
  out[written++] = py(to - 1);
  return written;
}

/** Draws an already-decimated pixel path. Kept separate so bar and scatter can reuse the buffer. */
export function strokePath(
  ctx: CanvasRenderingContext2D,
  pts: Float32Array,
  count: number,
  colour: string,
  lineWidth = 1.25,
): void {
  if (count < 4) return;
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < count; i += 2) {
    ctx.lineTo(pts[i], pts[i + 1]);
  }
  ctx.strokeStyle = colour;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.stroke();
}
