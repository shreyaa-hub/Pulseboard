'use client';

import { BarChart } from '@/components/charts/BarChart';
import { HeatmapChart } from '@/components/charts/HeatmapChart';
import { LineChart } from '@/components/charts/LineChart';
import { ScatterChart } from '@/components/charts/ScatterChart';
import { DataTable } from '@/components/ui/DataTable';
import { PerformanceMonitor } from '@/components/ui/PerformanceMonitor';
import { useDashboard } from '@/components/providers/DataProvider';

export function Dashboard() {
  const { store, driver } = useDashboard();
  const series = store.seriesMeta();
  const byId = (id: string) => series.find((s) => s.id === id);
  const barSeries = byId('spindle-load') ?? series[0];
  const scatterX = byId('spindle-load') ?? series[0];
  const scatterY = byId('vibration') ?? series[1] ?? series[0];

  return (
    <div className="dash">
      <PerformanceMonitor />
      <div className="dash-grid">
        {series.map((s) => (
          <LineChart key={s.id} driver={driver} store={store} series={s} />
        ))}
        {barSeries && <BarChart driver={driver} store={store} series={barSeries} />}
        {scatterX && scatterY && (
          <ScatterChart driver={driver} store={store} xSeries={scatterX} ySeries={scatterY} />
        )}
      </div>
      <HeatmapChart driver={driver} store={store} series={series} height={280} />
      <DataTable store={store} series={series} height={320} />
    </div>
  );
}
