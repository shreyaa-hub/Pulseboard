'use client';

import { LineChart } from '@/components/charts/LineChart';
import { PerformanceMonitor } from '@/components/ui/PerformanceMonitor';
import { useDashboard } from '@/components/providers/DataProvider';

export function Dashboard() {
  const { store, driver } = useDashboard();
  const series = store.seriesMeta();

  return (
    <div className="dash">
      <PerformanceMonitor />
      <div className="dash-grid">
        {series.map((s) => (
          <LineChart key={s.id} driver={driver} store={store} series={s} />
        ))}
      </div>
    </div>
  );
}
