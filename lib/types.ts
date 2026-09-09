export type SeriesId = string;

export const Status = {
  Normal: 0,
  Warning: 1,
  Critical: 2,
} as const;

export type Status = (typeof Status)[keyof typeof Status];

export interface SeriesMeta {
  id: SeriesId;
  label: string;
  unit: string;
  colour: string;
  /** Value the series drifts back toward. */
  baseline: number;
  /** Soft bounds used for the initial y-axis guess. */
  min: number;
  max: number;
}

export interface Tick {
  t: number;
  v: number;
  status: Status;
}

/**
 * Structure-of-arrays batch. The three arrays are parallel and always the same
 * length. Sent through postMessage as transferables, so the worker loses
 * ownership of the underlying buffers once posted.
 */
export interface TickBatch {
  seriesId: SeriesId;
  t: Float64Array;
  v: Float32Array;
  status: Uint8Array;
}

export interface Viewport {
  tMin: number;
  tMax: number;
  yMin: number;
  yMax: number;
}

export type Bucket = 'raw' | '1m' | '5m' | '1h';

export interface StoreStats {
  totalPoints: number;
  pointsPerSecond: number;
  oldestTimestamp: number;
  newestTimestamp: number;
  version: number;
}
