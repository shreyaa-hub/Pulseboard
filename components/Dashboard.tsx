'use client';

import { BarChart } from '@/components/charts/BarChart';
import { HeatmapChart } from '@/components/charts/HeatmapChart';
import { LineChart } from '@/components/charts/LineChart';
import { ScatterChart } from '@/components/charts/ScatterChart';
import { FilterPanel } from '@/components/controls/FilterPanel';
import { TimeRangeSelector } from '@/components/controls/TimeRangeSelector';
import { DataTable } from '@/components/ui/DataTable';
import { PerformanceMonitor } from '@/components/ui/PerformanceMonitor';
import { useDashboard } from '@/components/providers/DataProvider';

export function Dashboard() {
  const { store, driver, visibleSeriesIds, timeRangeMs, rangeToken, aggregation } = useDashboard();
  const allSeries = store.seriesMeta();
  const byId = (id: string) => allSeries.find((s) => s.id === id);

  // The filter panel hides/shows sensors in the line-chart grid and the
  // heatmap's rows. Bar and scatter are fixed correlation views over specific
  // series, so they're left alone — hiding "coolant temperature" shouldn't
  // make the vibration-vs-spindle-load scatter lose an axis.
  const visibleLineSeries = allSeries.filter((s) => visibleSeriesIds.has(s.id));
  const barSeries = byId('spindle-load') ?? allSeries[0];
  const scatterX = byId('spindle-load') ?? allSeries[0];
  const scatterY = byId('vibration') ?? allSeries[1] ?? allSeries[0];

  return (
    <div className="dash">
      <PerformanceMonitor />
      <div className="controls-row">
        <FilterPanel series={allSeries} />
        <TimeRangeSelector />
      </div>

      <div className="dash-grid">
        {visibleLineSeries.map((s) => (
          <LineChart
            key={s.id}
            driver={driver}
            store={store}
            series={s}
            rangeToken={rangeToken}
            rangeOverrideMs={timeRangeMs}
          />
        ))}
        {barSeries && (
          <BarChart
            driver={driver}
            store={store}
            series={barSeries}
            rangeToken={rangeToken}
            rangeOverrideMs={timeRangeMs}
            aggregation={aggregation}
          />
        )}
        {scatterX && scatterY && (
          <ScatterChart driver={driver} store={store} xSeries={scatterX} ySeries={scatterY} />
        )}
      </div>

      <HeatmapChart
        driver={driver}
        store={store}
        series={visibleLineSeries}
        height={280}
        rangeToken={rangeToken}
        rangeOverrideMs={timeRangeMs}
        aggregation={aggregation}
      />

      <DataTable store={store} series={allSeries} height={320} />
    </div>
  );
}
