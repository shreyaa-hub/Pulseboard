'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { SERIES } from '@/lib/dataGenerator';
import { DataStore } from '@/lib/dataStore';
import { RafDriver } from '@/lib/rafDriver';
import type { TickBatch } from '@/lib/types';
import type { WorkerIn, WorkerOut } from '@/workers/dataWorker';

export interface SerialisedBatch {
  seriesId: string;
  t: number[];
  v: number[];
  status: number[];
}

export type AggregationMode = 'auto' | '1m' | '5m' | '1h';

export const AGGREGATION_MS: Record<Exclude<AggregationMode, 'auto'>, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '1h': 3_600_000,
};

interface Ctx {
  store: DataStore;
  driver: RafDriver;
  pointsPerTick: number;
  setPointsPerTick: (n: number) => void;
  paused: boolean;
  setPaused: (p: boolean) => void;
  capacity: number;
  setCapacity: (n: number) => void;

  visibleSeriesIds: ReadonlySet<string>;
  toggleSeries: (id: string) => void;

  /** null = each chart keeps its own default window. A preset button sets an
   *  explicit width and bumps rangeToken so every time-based chart resyncs
   *  once, then goes back to being independently pannable/zoomable until the
   *  next preset click. */
  timeRangeMs: number | null;
  rangeToken: number;
  setTimeRange: (ms: number | null) => void;

  aggregation: AggregationMode;
  setAggregation: (mode: AggregationMode) => void;
}

const DataContext = createContext<Ctx | null>(null);

export function useDashboard(): Ctx {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useDashboard must be used inside <DataProvider>');
  return ctx;
}

const TICK_MS = 100;

export function DataProvider({
  initial,
  children,
}: {
  initial: SerialisedBatch[];
  children: React.ReactNode;
}) {
  const [capacity, setCapacityState] = useState(20_000);
  const [pointsPerTick, setPointsPerTickState] = useState(1);
  const [paused, setPausedState] = useState(false);

  const [visibleSeriesIds, setVisibleSeriesIds] = useState<ReadonlySet<string>>(
    () => new Set(SERIES.map((s) => s.id)),
  );
  const [timeRangeMs, setTimeRangeMs] = useState<number | null>(null);
  const [rangeToken, setRangeToken] = useState(0);
  const [aggregation, setAggregationState] = useState<AggregationMode>('auto');

  // Created once. Putting these in state would mean a new store on every
  // render, and every chart would lose its buffers.
  const store = useMemo(() => new DataStore(SERIES, 20_000), []);
  const driver = useMemo(() => new RafDriver(), []);
  const workerRef = useRef<Worker | null>(null);
  const seeded = useRef(false);

  if (!seeded.current) {
    // Server-rendered warmup, rehydrated into typed arrays. Runs during the
    // first render rather than in an effect so the first painted frame already
    // has a trace in it instead of an empty box.
    store.ingest(
      initial.map<TickBatch>((b) => ({
        seriesId: b.seriesId,
        t: Float64Array.from(b.t),
        v: Float32Array.from(b.v),
        status: Uint8Array.from(b.status),
      })),
    );
    seeded.current = true;
  }

  useEffect(() => {
    const worker = new Worker(new URL('../../workers/dataWorker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      if (e.data.type === 'batch') store.ingest(e.data.batches);
    };

    const start: WorkerIn = {
      type: 'start',
      startTime: Date.now(),
      intervalMs: TICK_MS,
      pointsPerTick: 1,
      seed: 0x5eed,
    };
    worker.postMessage(start);

    return () => {
      worker.postMessage({ type: 'stop' } satisfies WorkerIn);
      worker.terminate();
      workerRef.current = null;
      driver.dispose();
      store.dispose();
    };
  }, [store, driver]);

  const value = useMemo<Ctx>(
    () => ({
      store,
      driver,
      pointsPerTick,
      paused,
      capacity,
      visibleSeriesIds,
      timeRangeMs,
      rangeToken,
      aggregation,
      setPointsPerTick: (n) => {
        setPointsPerTickState(n);
        workerRef.current?.postMessage({ type: 'rate', pointsPerTick: n } satisfies WorkerIn);
      },
      setPaused: (p) => {
        setPausedState(p);
        driver.running = !p;
        workerRef.current?.postMessage({ type: 'pause', paused: p } satisfies WorkerIn);
      },
      setCapacity: (n) => {
        setCapacityState(n);
        store.setCapacity(n);
      },
      toggleSeries: (id) => {
        setVisibleSeriesIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      },
      setTimeRange: (ms) => {
        setTimeRangeMs(ms);
        setRangeToken((t) => t + 1);
      },
      setAggregation: setAggregationState,
    }),
    [store, driver, pointsPerTick, paused, capacity, visibleSeriesIds, timeRangeMs, rangeToken, aggregation],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
