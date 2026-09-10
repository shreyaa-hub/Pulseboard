/**
 * Three-stop colour ramp (cool -> warm -> hot) for a normalized 0..1
 * intensity. Kept as direct lerp math rather than a lookup table: at a few
 * hundred heatmap cells per frame this is nowhere near the frame budget, and
 * a LUT would just be a second thing to keep in sync with the stops below.
 */
const STOPS: readonly [number, number, number, number][] = [
  [0.0, 0x1a, 0x20, 0x40], // idle — dark slate-blue
  [0.5, 0xe0, 0xb8, 0x3c], // mid — amber, matches the app's warning colour
  [1.0, 0xef, 0x6f, 0x3c], // hot — red-orange, near the app's critical colour
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function rampColor(t: number): [number, number, number] {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  let lo = STOPS[0];
  let hi = STOPS[STOPS.length - 1];
  for (let i = 0; i < STOPS.length - 1; i++) {
    if (c >= STOPS[i][0] && c <= STOPS[i + 1][0]) {
      lo = STOPS[i];
      hi = STOPS[i + 1];
      break;
    }
  }
  const span = hi[0] - lo[0];
  const local = span > 0 ? (c - lo[0]) / span : 0;
  return [
    Math.round(lerp(lo[1], hi[1], local)),
    Math.round(lerp(lo[2], hi[2], local)),
    Math.round(lerp(lo[3], hi[3], local)),
  ];
}

/**
 * Writes one cell's RGBA into a packed buffer at (col, row) of a `cols`-wide
 * grid. `t` of NaN (no data in that bucket) paints `emptyRgb` instead of
 * running it through the ramp, so gaps read as "no data" rather than "cold."
 */
export function writeCell(
  data: Uint8ClampedArray,
  cols: number,
  col: number,
  row: number,
  t: number,
  emptyRgb: readonly [number, number, number],
): void {
  const idx = (row * cols + col) * 4;
  if (Number.isNaN(t)) {
    data[idx] = emptyRgb[0];
    data[idx + 1] = emptyRgb[1];
    data[idx + 2] = emptyRgb[2];
    data[idx + 3] = 255;
    return;
  }
  const [r, g, b] = rampColor(t);
  data[idx] = r;
  data[idx + 1] = g;
  data[idx + 2] = b;
  data[idx + 3] = 255;
}
