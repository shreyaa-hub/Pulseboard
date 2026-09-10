export interface FrameInfo {
  /** performance.now() at the start of this frame. */
  now: number;
  /** Milliseconds since the previous frame, clamped for tab-switch gaps. */
  delta: number;
  frame: number;
}

export type RenderFn = (frame: FrameInfo) => void;

export interface FrameStats {
  fps: number;
  /** Mean time spent inside render callbacks, ms. */
  renderTime: number;
  /** 95th percentile frame interval over the sample window, ms. */
  p95: number;
  worst: number;
  drawCount: number;
}

const SAMPLES = 120;

/**
 * One rAF loop for the whole dashboard. Four charts each running their own
 * loop means four separate callbacks per frame, no shared ordering, and no
 * single place to measure the frame cost — so charts register here instead.
 *
 * The loop only runs while something is registered.
 */
export class RafDriver {
  private readonly callbacks = new Set<RenderFn>();
  private handle: number | null = null;
  private frame = 0;
  private last = 0;

  private readonly intervals = new Float32Array(SAMPLES);
  private readonly sorted = new Float32Array(SAMPLES);
  private cursor = 0;
  private filled = 0;
  private renderTimeEma = 0;

  private stats: FrameStats = { fps: 0, renderTime: 0, p95: 0, worst: 0, drawCount: 0 };
  private statsListeners = new Set<() => void>();
  private statsTimer: ReturnType<typeof setInterval> | null = null;

  /** Set false to freeze rendering without unregistering charts. */
  running = true;

  register(fn: RenderFn): () => void {
    this.callbacks.add(fn);
    this.start();
    return () => {
      this.callbacks.delete(fn);
      if (this.callbacks.size === 0) this.stop();
    };
  }

  private start(): void {
    if (this.handle !== null) return;
    this.last = performance.now();
    this.handle = requestAnimationFrame(this.loop);
  }

  private stop(): void {
    if (this.handle === null) return;
    cancelAnimationFrame(this.handle);
    this.handle = null;
  }

  private loop = (now: number): void => {
    this.handle = requestAnimationFrame(this.loop);

    let delta = now - this.last;
    this.last = now;
    // A backgrounded tab produces a multi-second gap; recording it would poison
    // the percentile for the next two seconds of real frames.
    if (delta > 250) delta = 250;

    this.intervals[this.cursor] = delta;
    this.cursor = this.cursor + 1 === SAMPLES ? 0 : this.cursor + 1;
    if (this.filled < SAMPLES) this.filled++;

    if (!this.running) return;

    const info: FrameInfo = { now, delta, frame: this.frame++ };
    const t0 = performance.now();
    for (const fn of this.callbacks) fn(info);
    const spent = performance.now() - t0;

    this.renderTimeEma = this.renderTimeEma === 0 ? spent : this.renderTimeEma * 0.9 + spent * 0.1;
  };

  private computeStats(): void {
    const n = this.filled;
    if (n === 0) return;

    let sum = 0;
    let worst = 0;
    for (let i = 0; i < n; i++) {
      const v = this.intervals[i];
      sum += v;
      if (v > worst) worst = v;
      this.sorted[i] = v;
    }

    const view = this.sorted.subarray(0, n);
    view.sort();
    const p95 = view[Math.min(n - 1, Math.floor(n * 0.95))];

    this.stats = {
      fps: sum > 0 ? Math.round((n / sum) * 1000) : 0,
      renderTime: Math.round(this.renderTimeEma * 100) / 100,
      p95: Math.round(p95 * 100) / 100,
      worst: Math.round(worst * 100) / 100,
      drawCount: this.callbacks.size,
    };
  }

  subscribeStats = (listener: () => void): (() => void) => {
    this.statsListeners.add(listener);
    if (this.statsTimer === null) {
      this.statsTimer = setInterval(() => {
        this.computeStats();
        for (const l of this.statsListeners) l();
      }, 500);
    }
    return () => {
      this.statsListeners.delete(listener);
      if (this.statsListeners.size === 0 && this.statsTimer !== null) {
        clearInterval(this.statsTimer);
        this.statsTimer = null;
      }
    };
  };

  getStats = (): FrameStats => this.stats;

  dispose(): void {
    this.stop();
    this.callbacks.clear();
    this.statsListeners.clear();
    if (this.statsTimer !== null) clearInterval(this.statsTimer);
    this.statsTimer = null;
  }
}
