'use client';

import { useDashboard } from '@/components/providers/DataProvider';
import type { SeriesMeta } from '@/lib/types';

/**
 * Filters which sensors are visible in the line-chart grid and the heatmap's
 * rows. Deliberately doesn't touch the bar or scatter panels — those are
 * fixed correlation views over specific series (spindle load, vibration),
 * not a general survey of "everything," so toggling a sensor off elsewhere
 * shouldn't make one of them lose its axis.
 */
export function FilterPanel({ series }: { series: readonly SeriesMeta[] }) {
  const { visibleSeriesIds, toggleSeries } = useDashboard();

  return (
    <fieldset className="filter-panel">
      <legend>Sensors</legend>
      {series.map((s) => {
        const active = visibleSeriesIds.has(s.id);
        return (
          <button
            key={s.id}
            type="button"
            aria-pressed={active}
            className="filter-chip"
            style={{ borderColor: active ? s.colour : undefined }}
            onClick={() => toggleSeries(s.id)}
          >
            <span className="filter-dot" style={{ background: active ? s.colour : 'transparent' }} />
            {s.label}
          </button>
        );
      })}
    </fieldset>
  );
}
