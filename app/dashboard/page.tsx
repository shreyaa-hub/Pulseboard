import { Dashboard } from '@/components/Dashboard';
import { DataProvider, type SerialisedBatch } from '@/components/providers/DataProvider';
import { DataGenerator } from '@/lib/dataGenerator';

// Regenerated per request so the opening window always ends at "now".
export const dynamic = 'force-dynamic';

const WARMUP_POINTS = 600;

export default async function DashboardPage() {
  const gen = new DataGenerator(Date.now(), { seed: 0x5eed, intervalMs: 100 });

  // Typed arrays don't survive the RSC boundary, so they go over as plain
  // arrays. 600 points across six series is about 11k numbers — enough for the
  // first paint to show a real trace, small enough not to bloat the payload.
  // The worker takes over from there.
  const initial: SerialisedBatch[] = gen.warmup(WARMUP_POINTS).map((b) => ({
    seriesId: b.seriesId,
    t: Array.from(b.t),
    v: Array.from(b.v),
    status: Array.from(b.status),
  }));

  return (
    <DataProvider initial={initial}>
      <Dashboard />
    </DataProvider>
  );
}
