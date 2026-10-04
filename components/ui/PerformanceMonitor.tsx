'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useDashboard } from '@/components/providers/DataProvider';

const LOADS = [1, 5, 20, 50];
const CAPACITIES = [10_000, 50_000, 100_000];

// Chrome-only: total memory the page's JavaScript is using right now.
function readHeapMB(): number | null {
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return mem ? mem.usedJSHeapSize / 1_048_576 : null;
}

export function PerformanceMonitor() {
  const { store, driver, pointsPerTick, setPointsPerTick, paused, setPaused, capacity, setCapacity } =
    useDashboard();

  const frame = useSyncExternalStore(driver.subscribeStats, driver.getStats, () => driver.getStats());
  const stats = useSyncExternalStore(store.subscribeStats, store.getStats, () => store.getStats());

  const held = (store.bytesHeld() / 1_048_576).toFixed(1);

  // Read heap once a second, only in the browser (avoids server/client mismatch).
  const [heap, setHeap] = useState<number | null>(null);
  useEffect(() => {
    setHeap(readHeapMB());
    const id = setInterval(() => setHeap(readHeapMB()), 1000);
    return () => clearInterval(id);
  }, []);

  const stress = pointsPerTick === 100 && capacity === 100_000;
  const toggleStress = () => {
    if (stress) {
      setPointsPerTick(1);
      setCapacity(20_000);
    } else {
      setPaused(false);
      setPointsPerTick(100);
      setCapacity(100_000);
    }
  };

  return (
    <aside className="perf">
      <dl className="perf-figures">
        <div>
          <dt>Frames per second</dt>
          <dd className={frame.fps < 50 ? 'warn' : undefined}>{frame.fps}</dd>
        </div>
        <div>
          <dt>Frame time, 95th</dt>
          <dd>{frame.p95.toFixed(1)} ms</dd>
        </div>
        <div>
          <dt>Draw cost</dt>
          <dd>{frame.renderTime.toFixed(2)} ms</dd>
        </div>
        <div>
          <dt>Points held</dt>
          <dd>{stats.totalPoints.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Arriving</dt>
          <dd>{stats.pointsPerSecond.toLocaleString()}/s</dd>
        </div>
        <div>
          <dt>Data buffers</dt>
          <dd>{held} MB</dd>
        </div>
        <div>
          <dt>JS heap</dt>
          <dd>{heap === null ? 'n/a' : `${heap.toFixed(1)} MB`}</dd>
        </div>
      </dl>

      <div className="perf-controls">
        <button type="button" onClick={() => setPaused(!paused)}>
          {paused ? 'Resume feed' : 'Pause feed'}
        </button>

        <button type="button" aria-pressed={stress} onClick={toggleStress}>
          {stress ? 'Stop stress test' : 'Stress test'}
        </button>

        <fieldset>
          <legend>Points per tick</legend>
          {LOADS.map((n) => (
            <button key={n} type="button" aria-pressed={pointsPerTick === n} onClick={() => setPointsPerTick(n)}>
              {n}
            </button>
          ))}
        </fieldset>

        <fieldset>
          <legend>Buffer size</legend>
          {CAPACITIES.map((n) => (
            <button key={n} type="button" aria-pressed={capacity === n} onClick={() => setCapacity(n)}>
              {n / 1000}k
            </button>
          ))}
        </fieldset>
      </div>
    </aside>
  );
}