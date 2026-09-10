import { SeriesBuffer } from './ringBuffer';
import type { SeriesId, SeriesMeta, StoreStats, TickBatch } from './types';

type Unsubscribe = () => void;

/**
 * Owns every data point in the app. Deliberately not React state: at 10 ticks
 * a second, routing points through useState means ten reconciliations a second
 * and the frame budget is gone before anything is drawn. Charts read the
 * buffers directly inside the rAF loop; React only ever sees the small stats
 * object below, and only a few times a second.
 */
export class DataStore {
  private readonly buffers = new Map<SeriesId, SeriesBuffer>();
  private readonly meta = new Map<SeriesId, SeriesMeta>();

  private readonly metaListeners = new Set<() => void>();
  private snapshot: StoreStats;
  private snapshotDirty = false;
  private notifyTimer: ReturnType<typeof setInterval> | null = null;

  private version = 0;
  private ingested = 0;
  private lastRateSample = 0;
  private lastRateCount = 0;
  private rate = 0;

  /** How often React is allowed to hear about new data. */
  readonly notifyIntervalMs: number;

  constructor(
    series: readonly SeriesMeta[],
    private capacity: number,
    notifyIntervalMs = 250,
  ) {
    this.notifyIntervalMs = notifyIntervalMs;
    for (const s of series) {
      this.meta.set(s.id, s);
      this.buffers.set(s.id, new SeriesBuffer(capacity));
    }
    this.snapshot = {
      totalPoints: 0,
      pointsPerSecond: 0,
      oldestTimestamp: 0,
      newestTimestamp: 0,
      version: 0,
    };
  }

  seriesMeta(): readonly SeriesMeta[] {
    return [...this.meta.values()];
  }

  buffer(id: SeriesId): SeriesBuffer | undefined {
    return this.buffers.get(id);
  }

  ingest(batches: readonly TickBatch[]): void {
    for (const b of batches) {
      const buf = this.buffers.get(b.seriesId);
      if (!buf) continue;
      buf.pushBatch(b.t, b.v, b.status);
      this.ingested += b.t.length;
    }
    this.version++;
    this.snapshotDirty = true;
  }

  /**
   * Rebuilding the buffers is the only way to change capacity, so this drops
   * history. The alternative — copying live points into new arrays — keeps the
   * old arrays alive until the next GC, which is exactly the spike the memory
   * readout is meant to catch.
   */
  setCapacity(capacity: number): void {
    if (capacity === this.capacity) return;
    this.capacity = capacity;
    for (const id of this.buffers.keys()) {
      this.buffers.set(id, new SeriesBuffer(capacity));
    }
    this.version++;
    this.snapshotDirty = true;
    this.publish();
  }

  clear(): void {
    for (const b of this.buffers.values()) b.clear();
    this.ingested = 0;
    this.lastRateCount = 0;
    this.version++;
    this.snapshotDirty = true;
    this.publish();
  }

  bytesHeld(): number {
    let n = 0;
    for (const b of this.buffers.values()) n += b.byteLength();
    return n;
  }

  /**
   * For useSyncExternalStore. The callback fires on a timer rather than on
   * every ingest, so the render rate is decoupled from the data rate.
   */
  subscribeStats = (listener: () => void): Unsubscribe => {
    this.metaListeners.add(listener);
    if (this.notifyTimer === null) {
      this.lastRateSample = performance.now();
      this.notifyTimer = setInterval(() => this.publish(), this.notifyIntervalMs);
    }
    return () => {
      this.metaListeners.delete(listener);
      if (this.metaListeners.size === 0 && this.notifyTimer !== null) {
        clearInterval(this.notifyTimer);
        this.notifyTimer = null;
      }
    };
  };

  /** Must be referentially stable between publishes or React will loop. */
  getStats = (): StoreStats => this.snapshot;

  private publish(): void {
    const now = performance.now();
    const elapsed = now - this.lastRateSample;
    if (elapsed > 0) {
      const delta = this.ingested - this.lastRateCount;
      this.rate = (delta * 1000) / elapsed;
      this.lastRateSample = now;
      this.lastRateCount = this.ingested;
    }

    if (!this.snapshotDirty) {
      // Rate still needs refreshing so it decays to zero when the feed pauses.
      if (this.snapshot.pointsPerSecond === Math.round(this.rate)) return;
    }

    let total = 0;
    let oldest = Infinity;
    let newest = 0;
    for (const b of this.buffers.values()) {
      total += b.length;
      if (b.length > 0) {
        const first = b.timeAt(0);
        const last = b.timeAt(b.length - 1);
        if (first < oldest) oldest = first;
        if (last > newest) newest = last;
      }
    }

    this.snapshot = {
      totalPoints: total,
      pointsPerSecond: Math.round(this.rate),
      oldestTimestamp: oldest === Infinity ? 0 : oldest,
      newestTimestamp: newest,
      version: this.version,
    };
    this.snapshotDirty = false;

    for (const l of this.metaListeners) l();
  }

  dispose(): void {
    if (this.notifyTimer !== null) clearInterval(this.notifyTimer);
    this.notifyTimer = null;
    this.metaListeners.clear();
  }
}
