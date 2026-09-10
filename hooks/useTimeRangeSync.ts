import { useEffect, useRef } from 'react';
import type { Viewport } from '@/lib/types';

interface Syncable {
  vp: Viewport;
  following: boolean;
}

/**
 * Each chart owns its pan/zoom state privately (in useChartInteraction's
 * ref) so that scrolling one chart doesn't touch the others. A global preset
 * button ("last 5 minutes") needs to reach into all of them at once anyway —
 * this hook is that one-way door.
 *
 * It only fires on a genuine change to `token`, not on mount, so a chart that
 * mounts after the dashboard has already been up for a while doesn't get
 * silently reset to whatever the last-clicked preset was; it keeps its own
 * default until the user clicks a preset again.
 */
export function useTimeRangeSync(
  stateRef: { current: Syncable },
  token: number,
  windowMs: number | null,
  getOldestTimestamp: () => number | null,
): void {
  const prevToken = useRef(token);

  useEffect(() => {
    if (token === prevToken.current) return;
    prevToken.current = token;

    const now = Date.now();
    const oldest = getOldestTimestamp();
    const tMin = windowMs != null ? now - windowMs : (oldest ?? now - 60_000);

    stateRef.current.vp = { ...stateRef.current.vp, tMin, tMax: now };
    stateRef.current.following = true;
    // getOldestTimestamp is called, not depended on — it reads live buffer
    // state at the moment of the click and has no stable identity worth
    // tracking as a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, windowMs, stateRef]);
}
