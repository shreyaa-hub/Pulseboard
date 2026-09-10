import type { SeriesBuffer } from './ringBuffer';

export interface BucketResult {
  /** Number of buckets actually populated (<= capacity). */
  count: number;
}

/**
 * Aggregates points into fixed-width time buckets aligned to `tMin`. This is
 * the spec's "group by time period" requirement, and it doubles as the bar
 * chart's data reduction: instead of decimating a continuous line, points are
 * collapsed into one summary value per bucket, which is what a bar
 * legitimately represents.
 *
 * All four output arrays are caller-owned and sized to `bucketCount` — sum and
 * count together give the mean without a division inside the hot loop, and
 * min/max are kept so the bar can optionally draw a range indicator.
 */
export function bucketAggregate(
  buf: SeriesBuffer,
  from: number,
  to: number,
  tMin: number,
  bucketMs: number,
  bucketCount: number,
  outSum: Float64Array,
  outCount: Int32Array,
  outMin: Float32Array,
  outMax: Float32Array,
): BucketResult {
  outSum.fill(0, 0, bucketCount);
  outCount.fill(0, 0, bucketCount);
  outMin.fill(Infinity, 0, bucketCount);
  outMax.fill(-Infinity, 0, bucketCount);

  let populated = 0;
  for (let i = from; i < to; i++) {
    const t = buf.timeAt(i);
    let b = Math.floor((t - tMin) / bucketMs);
    if (b < 0) b = 0;
    else if (b >= bucketCount) continue; // point sits beyond the requested window

    const v = buf.valueAt(i);
    if (outCount[b] === 0) populated++;
    outSum[b] += v;
    outCount[b]++;
    if (v < outMin[b]) outMin[b] = v;
    if (v > outMax[b]) outMax[b] = v;
  }

  return { count: populated };
}

/** Bucket width for a target bar count across a given time span. Snapped to
 *  round seconds so bar edges line up with clock time instead of falling on
 *  arbitrary fractions. */
export function pickBucketMs(spanMs: number, targetBars: number): number {
  const raw = spanMs / targetBars;
  const steps = [1000, 2000, 5000, 10000, 15000, 30000, 60000, 300000, 900000, 3600000];
  for (const s of steps) {
    if (s >= raw) return s;
  }
  return steps[steps.length - 1];
}
