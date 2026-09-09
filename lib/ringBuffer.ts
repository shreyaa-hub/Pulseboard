/**
 * Fixed-capacity ring buffer for a single time series.
 *
 * Three parallel typed arrays instead of an array of objects: no per-point
 * allocation, no GC pressure, and the memory footprint is decided once at
 * construction and never changes. 100k points costs 100k*8 + 100k*4 + 100k*1
 * = ~1.3 MB, flat, forever.
 *
 * Timestamps are assumed monotonically increasing on push, which is what makes
 * the binary search below valid.
 */
export class SeriesBuffer {
  readonly capacity: number;

  private readonly ts: Float64Array;
  private readonly vals: Float32Array;
  private readonly stats: Uint8Array;

  /** Physical slot the next push will write to. */
  private head = 0;
  /** Number of live points, saturating at capacity. */
  private len = 0;

  constructor(capacity: number) {
    if (capacity < 2) throw new RangeError('capacity must be >= 2');
    this.capacity = capacity;
    this.ts = new Float64Array(capacity);
    this.vals = new Float32Array(capacity);
    this.stats = new Uint8Array(capacity);
  }

  get length(): number {
    return this.len;
  }

  /** Physical slot of the oldest live point. */
  private get tail(): number {
    return this.len < this.capacity ? 0 : this.head;
  }

  /** Maps a logical index (0 = oldest) onto its physical slot. */
  private slot(i: number): number {
    const s = this.tail + i;
    return s >= this.capacity ? s - this.capacity : s;
  }

  push(t: number, v: number, status: number): void {
    this.ts[this.head] = t;
    this.vals[this.head] = v;
    this.stats[this.head] = status;

    this.head = this.head + 1 === this.capacity ? 0 : this.head + 1;
    if (this.len < this.capacity) this.len++;
  }

  pushBatch(t: Float64Array, v: Float32Array, status: Uint8Array): void {
    // Copying slot by slot rather than with .set() because a batch can wrap the
    // end of the buffer, and splitting it into two .set() calls is only worth
    // the complexity for batches far bigger than the ~10 points we get per tick.
    for (let i = 0; i < t.length; i++) {
      this.push(t[i], v[i], status[i]);
    }
  }

  timeAt(i: number): number {
    return this.ts[this.slot(i)];
  }

  valueAt(i: number): number {
    return this.vals[this.slot(i)];
  }

  statusAt(i: number): number {
    return this.stats[this.slot(i)];
  }

  /**
   * First logical index with timestamp >= t, or length if there is none.
   * Callers pair this with indexAfter to get a half-open render window without
   * scanning the whole buffer.
   */
  indexAtOrAfter(t: number): number {
    let lo = 0;
    let hi = this.len;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.ts[this.slot(mid)] < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** First logical index with timestamp > t. */
  indexAfter(t: number): number {
    let lo = 0;
    let hi = this.len;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.ts[this.slot(mid)] <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /**
   * Min and max value over a logical index range, written into `out` to avoid
   * allocating on every frame. Returns false if the range is empty.
   */
  extent(from: number, to: number, out: Float32Array): boolean {
    if (to <= from) return false;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = from; i < to; i++) {
      const v = this.vals[this.slot(i)];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    out[0] = lo;
    out[1] = hi;
    return true;
  }

  clear(): void {
    this.head = 0;
    this.len = 0;
  }

  /** Bytes held by the three arrays. Used by the memory readout in the UI. */
  byteLength(): number {
    return this.ts.byteLength + this.vals.byteLength + this.stats.byteLength;
  }
}
