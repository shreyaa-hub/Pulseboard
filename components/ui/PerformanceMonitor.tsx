'use client';

import { useSyncExternalStore } from 'react';
import { useDashboard } from '@/components/providers/DataProvider';

const LOADS = [1, 5, 20, 50];
const CAPACITIES = [10_000, 50_000, 100_000];

export function PerformanceMonitor() {
  const { store, driver, pointsPerTick, setPointsPerTick, paused, setPaused, capacity, setCapacity } =
    useDashboard();

  // Both stores publish on their own timers, so this component renders a few
  // times a second regardless of how fast data is arriving or frames are drawn.
  const frame = useSyncExternalStore(driver.subscribeStats, driver.getStats, () => driver.getStats());
  const stats = useSyncExternalStore(store.subscribeStats, store.getStats, () => store.getStats());

  const held = (store.bytesHeld() / 1_048_576).toFixed(1);

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
          <dt>Buffers</dt>
          <dd>{held} MB</dd>
        </div>
      </dl>

      <div className="perf-controls">
        <button type="button" onClick={() => setPaused(!paused)}>
          {paused ? 'Resume feed' : 'Pause feed'}
        </button>

        <fieldset>
          <legend>Points per tick</legend>
          {LOADS.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={pointsPerTick === n}
              onClick={() => setPointsPerTick(n)}
            >
              {n}
            </button>
          ))}
        </fieldset>

        <fieldset>
          <legend>Buffer size</legend>
          {CAPACITIES.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={capacity === n}
              onClick={() => setCapacity(n)}
            >
              {n / 1000}k
            </button>
          ))}
        </fieldset>
      </div>
    </aside>
  );
}
