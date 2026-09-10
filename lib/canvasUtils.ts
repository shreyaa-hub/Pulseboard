export interface CanvasSize {
  /** CSS pixels. */
  width: number;
  height: number;
  dpr: number;
}

/**
 * Resizes the backing store to match the element's CSS size times the device
 * pixel ratio, then scales the context so all drawing code can keep working in
 * CSS pixels. Skipped when nothing changed — assigning to canvas.width clears
 * the canvas and reallocates the backing store, so doing it every frame is
 * both a visible flicker and a steady stream of garbage.
 *
 * Returns true if the canvas was resized, which the caller should treat as
 * "everything must be redrawn".
 */
export function syncCanvasSize(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  size: CanvasSize,
): boolean {
  const w = Math.round(size.width * size.dpr);
  const h = Math.round(size.height * size.dpr);
  if (canvas.width === w && canvas.height === h) return false;

  canvas.width = w;
  canvas.height = h;
  canvas.style.width = `${size.width}px`;
  canvas.style.height = `${size.height}px`;
  ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
  return true;
}

export function currentDpr(): number {
  // Capped because a 3x phone screen triples fill cost for no visible gain on
  // 1px strokes, and it is the difference between 60fps and 40fps on mobile.
  return Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 2);
}

/**
 * Round tick values at 1/2/5 x 10^n. Written into `out` and the count
 * returned, so axis redraws don't allocate.
 */
export function niceTicks(min: number, max: number, target: number, out: Float64Array): number {
  if (!(max > min) || target < 2) return 0;

  const raw = (max - min) / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;

  const first = Math.ceil(min / step) * step;
  let n = 0;
  for (let i = 0; ; i++) {
    // Re-derived from the index each time; accumulating v += step compounds
    // float error and ticks land on 0.30000000000000004.
    const v = first + i * step;
    if (v > max + step * 1e-9 || n >= out.length) break;
    out[n++] = v;
  }
  return n;
}

const TIME_STEPS = [
  1000, 5000, 15000, 30000,
  60000, 300000, 900000, 1800000,
  3600000, 10800000, 21600000, 43200000, 86400000,
];

/** Same idea as niceTicks but snapped to clock-friendly intervals. */
export function timeTicks(tMin: number, tMax: number, target: number, out: Float64Array): number {
  if (!(tMax > tMin)) return 0;

  const raw = (tMax - tMin) / target;
  let step = TIME_STEPS[TIME_STEPS.length - 1];
  for (const s of TIME_STEPS) {
    if (s >= raw) {
      step = s;
      break;
    }
  }

  const first = Math.ceil(tMin / step) * step;
  let n = 0;
  for (let i = 0; ; i++) {
    const v = first + i * step;
    if (v > tMax || n >= out.length) break;
    out[n++] = v;
  }
  return n;
}

const hms = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function formatClock(t: number): string {
  return hms.format(t);
}

/** formatClock loses sub-second detail, which is fine for an axis label but
 *  means two consecutive 100ms ticks in a table would print identically.
 *  This appends the millisecond remainder so adjacent rows stay visually
 *  distinct. */
export function formatClockMs(t: number): string {
  const ms = String(Math.floor(t) % 1000).padStart(3, '0');
  return `${hms.format(t)}.${ms}`;
}

export function formatValue(v: number, span: number): string {
  const digits = span >= 100 ? 0 : span >= 10 ? 1 : span >= 1 ? 2 : 3;
  return v.toFixed(digits);
}

/**
 * ctx.fillText has no concept of overflow — a label wider than its allotted
 * space just runs past the canvas edge with nothing to show it was cut,
 * which is exactly what "Coolant temperature" does in the heatmap's label
 * gutter. This binary-searches down to the longest prefix (plus an ellipsis)
 * that actually fits maxWidth, using the context's current font.
 */
export function truncateToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;

  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    const candidate = text.slice(0, mid) + '…';
    if (ctx.measureText(candidate).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + '…' : '…';
}

/**
 * Crisp 1px lines. A vertical line at x=100 with lineWidth 1 covers half of
 * pixel 99 and half of 100, so it renders as two grey pixels instead of one
 * dark one. Offsetting by half a pixel fixes it.
 */
export function crisp(x: number): number {
  return Math.round(x) + 0.5;
}
