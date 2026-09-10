import { Status, type SeriesMeta, type TickBatch } from './types';

/** mulberry32 — small, fast, and seedable so benchmark runs are reproducible. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  // Box-Muller, second variate discarded. Cheap enough at our tick rate that
  // caching the pair isn't worth the extra state.
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

export const SERIES: readonly SeriesMeta[] = [
  { id: 'inlet-pressure', label: 'Inlet pressure', unit: 'kPa', colour: '#4c9aff', baseline: 320, min: 240, max: 400 },
  { id: 'coolant-temp', label: 'Coolant temperature', unit: '°C', colour: '#ff8b5a', baseline: 74, min: 55, max: 95 },
  { id: 'spindle-load', label: 'Spindle load', unit: '%', colour: '#8f7bff', baseline: 62, min: 10, max: 100 },
  { id: 'vibration', label: 'Vibration', unit: 'mm/s', colour: '#3ec9a7', baseline: 2.4, min: 0, max: 12 },
  { id: 'flow-rate', label: 'Flow rate', unit: 'L/min', colour: '#e0b83c', baseline: 48, min: 20, max: 70 },
  { id: 'power-draw', label: 'Power draw', unit: 'kW', colour: '#ef6f8b', baseline: 133, min: 60, max: 220 },
];

interface SeriesState {
  meta: SeriesMeta;
  value: number;
  /** Current volatility, itself mean-reverting — this is what produces the
   *  calm stretches and busy stretches that make the trace look real. */
  vol: number;
  /** Countdown of ticks remaining in an anomaly excursion. */
  anomalyTicks: number;
  anomalyPush: number;
}

export interface GeneratorOptions {
  seed?: number;
  /** Wall-clock ms between ticks; also the timestamp step. */
  intervalMs?: number;
  /** Points emitted per series per tick. Raise this to stress the pipeline. */
  pointsPerTick?: number;
  seriesIds?: readonly string[];
}

/**
 * Ornstein-Uhlenbeck-ish walk with clustered volatility, a slow diurnal cycle
 * and occasional excursions. Nothing here is physically accurate, it just has
 * the statistical texture of instrument data instead of looking like noise.
 */
export class DataGenerator {
  private readonly rng: () => number;
  private readonly states: SeriesState[];
  private readonly intervalMs: number;

  pointsPerTick: number;
  private clock: number;

  constructor(startTime: number, opts: GeneratorOptions = {}) {
    const { seed = 0x5eed, intervalMs = 100, pointsPerTick = 1, seriesIds } = opts;

    this.rng = makeRng(seed);
    this.intervalMs = intervalMs;
    this.pointsPerTick = pointsPerTick;
    this.clock = startTime;

    const chosen = seriesIds ? SERIES.filter((s) => seriesIds.includes(s.id)) : SERIES;
    this.states = chosen.map((meta) => ({
      meta,
      value: meta.baseline,
      vol: (meta.max - meta.min) * 0.012,
      anomalyTicks: 0,
      anomalyPush: 0,
    }));
  }

  get seriesMeta(): readonly SeriesMeta[] {
    return this.states.map((s) => s.meta);
  }

  /** Backfills `count` points per series ending at the generator's clock. */
  warmup(count: number): TickBatch[] {
    const start = this.clock - count * this.intervalMs;
    this.clock = start;
    const batches = this.states.map((s) => this.allocBatch(s.meta.id, count));

    for (let i = 0; i < count; i++) {
      this.clock += this.intervalMs;
      for (let j = 0; j < this.states.length; j++) {
        this.write(batches[j], i, this.states[j], this.clock);
      }
    }
    return batches;
  }

  /** Advances one interval and returns one batch per series. */
  tick(): TickBatch[] {
    const n = this.pointsPerTick;
    const batches = this.states.map((s) => this.allocBatch(s.meta.id, n));

    for (let i = 0; i < n; i++) {
      // Sub-steps share a tick interval, so they get a fraction of it each.
      this.clock += this.intervalMs / n;
      for (let j = 0; j < this.states.length; j++) {
        this.write(batches[j], i, this.states[j], this.clock);
      }
    }
    return batches;
  }

  private allocBatch(seriesId: string, n: number): TickBatch {
    return {
      seriesId,
      t: new Float64Array(n),
      v: new Float32Array(n),
      status: new Uint8Array(n),
    };
  }

  private write(batch: TickBatch, i: number, s: SeriesState, t: number): void {
    const { meta } = s;
    const span = meta.max - meta.min;

    // Volatility reverts to 1.2% of range but wanders, which clusters the noise.
    const volTarget = span * 0.012;
    s.vol += (volTarget - s.vol) * 0.02 + gaussian(this.rng) * span * 0.0015;
    if (s.vol < span * 0.002) s.vol = span * 0.002;

    // 40-minute cycle standing in for a shift/load pattern.
    const phase = (t % 2_400_000) / 2_400_000;
    const seasonal = Math.sin(phase * Math.PI * 2) * span * 0.06;

    if (s.anomalyTicks === 0 && this.rng() < 0.00035) {
      s.anomalyTicks = 40 + Math.floor(this.rng() * 160);
      s.anomalyPush = (this.rng() < 0.5 ? -1 : 1) * span * (0.15 + this.rng() * 0.25);
    }

    let excursion = 0;
    if (s.anomalyTicks > 0) {
      // Ramp in, hold, decay out — a step function reads as fake.
      const k = s.anomalyTicks;
      excursion = s.anomalyPush * Math.min(1, k / 30);
      s.anomalyTicks--;
    }

    // Keep the target inside the range. Without this an excursion on a series
    // whose baseline sits near one rail (vibration) parks the value on the
    // clamp for a few hundred points and draws a dead flat line.
    const lo = meta.min + span * 0.05;
    const hi = meta.max - span * 0.05;
    let target = meta.baseline + seasonal + excursion;
    if (target < lo) target = lo;
    else if (target > hi) target = hi;

    s.value += (target - s.value) * 0.06 + gaussian(this.rng) * s.vol;

    // Hard clamp at the sensor's range, as a real transducer would.
    if (s.value < meta.min) s.value = meta.min;
    else if (s.value > meta.max) s.value = meta.max;

    const deviation = Math.abs(s.value - meta.baseline) / span;
    const status =
      deviation > 0.3 ? Status.Critical : deviation > 0.18 ? Status.Warning : Status.Normal;

    batch.t[i] = t;
    batch.v[i] = s.value;
    batch.status[i] = status;
  }
}
