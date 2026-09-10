'use client';

import { useDashboard, type AggregationMode } from '@/components/providers/DataProvider';

const RANGES: readonly { label: string; ms: number | null }[] = [
  { label: '30s', ms: 30_000 },
  { label: '1m', ms: 60_000 },
  { label: '5m', ms: 300_000 },
  { label: '15m', ms: 900_000 },
  { label: '1h', ms: 3_600_000 },
  { label: 'All', ms: null },
];

const AGGREGATIONS: readonly { label: string; value: AggregationMode }[] = [
  { label: 'Auto', value: 'auto' },
  { label: '1 min', value: '1m' },
  { label: '5 min', value: '5m' },
  { label: '1 hour', value: '1h' },
];

/**
 * Two related but separate controls: a time-range preset applies once and
 * then lets every chart go back to being independently pannable (see
 * useTimeRangeSync); the aggregation mode is a standing override that stays
 * in effect for the bar chart and heatmap's bucket width until changed again.
 */
export function TimeRangeSelector() {
  const { timeRangeMs, setTimeRange, aggregation, setAggregation } = useDashboard();

  return (
    <div className="range-selector">
      <fieldset>
        <legend>Time range</legend>
        {RANGES.map((r) => (
          <button
            key={r.label}
            type="button"
            aria-pressed={timeRangeMs === r.ms}
            onClick={() => setTimeRange(r.ms)}
          >
            {r.label}
          </button>
        ))}
      </fieldset>

      <fieldset>
        <legend>Aggregate by</legend>
        {AGGREGATIONS.map((a) => (
          <button
            key={a.value}
            type="button"
            aria-pressed={aggregation === a.value}
            onClick={() => setAggregation(a.value)}
          >
            {a.label}
          </button>
        ))}
      </fieldset>
    </div>
  );
}
