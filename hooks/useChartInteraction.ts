'use client';

import { useEffect, useRef } from 'react';
import type { Viewport } from '@/lib/types';
import { MIN_SPAN_MS, panTime, zoomTime, type PlotArea } from '@/lib/viewport';

export interface InteractionState {
  vp: Viewport;
  /** Window slides with incoming data until the user takes over. */
  following: boolean;
  /** Pointer x in CSS pixels, or -1 when the pointer is outside. */
  hoverX: number;
  hoverY: number;
  dragging: boolean;
}

/**
 * Owns the viewport as a mutable ref rather than React state.
 *
 * Pointer moves fire faster than frames on a 120Hz trackpad, and a wheel zoom
 * emits a burst of events. Routing any of that through setState renders the
 * chart tree several times per frame to produce one drawn frame. The rAF loop
 * reads whatever the ref holds when it happens to run, which is the correct
 * sampling behaviour and costs no renders at all.
 */
export function useChartInteraction(
  initial: Viewport,
  areaRef: React.RefObject<PlotArea>,
  onChange?: () => void,
) {
  const stateRef = useRef<InteractionState>({
    vp: initial,
    following: true,
    hoverX: -1,
    hoverY: -1,
    dragging: false,
  });
  const elementRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = elementRef.current;
    if (!el) return;

    const s = stateRef.current;
    const pointers = new Map<number, { x: number; y: number }>();
    let lastPanX = 0;
    let pinchStart = 0;
    let pinchSpan = 0;

    const notify = () => onChange?.();

    const onWheel = (e: WheelEvent) => {
      const area = areaRef.current;
      if (!area) return;

      // A plain two-finger scroll and a pinch gesture both arrive as wheel
      // events on a trackpad. Zooming on every one of them means a chart
      // sitting anywhere on the page blocks the page from scrolling at all —
      // genuinely bad, and the reason for this gate. Browsers already mark
      // real pinch gestures with ctrlKey:true (a long-standing convention,
      // not something detected here), so requiring it also means pinch still
      // zooms naturally; only an unmodified scroll is left alone.
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const anchor = Math.min(1, Math.max(0, (x - area.left) / area.width));

      // deltaMode 1 is lines, not pixels — Firefox reports wheel that way and
      // without this branch it zooms about 40x too fast there.
      const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const factor = Math.exp(px * 0.0015);

      s.vp = zoomTime(s.vp, factor, anchor);
      s.following = false;
      notify();
    };

    const onPointerDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      el.setPointerCapture(e.pointerId);

      if (pointers.size === 1) {
        s.dragging = true;
        lastPanX = e.clientX;
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStart = Math.abs(a.x - b.x) || 1;
        pinchSpan = s.vp.tMax - s.vp.tMin;
        s.dragging = false;
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const area = areaRef.current;
      if (!area) return;

      const rect = el.getBoundingClientRect();
      s.hoverX = e.clientX - rect.left;
      s.hoverY = e.clientY - rect.top;

      if (pointers.has(e.pointerId)) {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }

      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const spread = Math.abs(a.x - b.x) || 1;
        const target = Math.max(MIN_SPAN_MS, pinchSpan * (pinchStart / spread));
        const centre = (s.vp.tMin + s.vp.tMax) / 2;
        s.vp = { ...s.vp, tMin: centre - target / 2, tMax: centre + target / 2 };
        s.following = false;
        notify();
        return;
      }

      if (s.dragging) {
        const dx = e.clientX - lastPanX;
        lastPanX = e.clientX;
        const msPerPx = (s.vp.tMax - s.vp.tMin) / area.width;
        s.vp = panTime(s.vp, -dx * msPerPx);
        s.following = false;
        notify();
      }
    };

    const endPointer = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size === 0) s.dragging = false;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };

    const onLeave = () => {
      s.hoverX = -1;
      s.hoverY = -1;
    };

    const onDoubleClick = () => {
      s.following = true;
      notify();
    };

    // passive:false because the handler calls preventDefault to stop the page
    // scrolling under the cursor; Chrome treats wheel listeners as passive by
    // default and would ignore it.
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', endPointer);
    el.addEventListener('pointercancel', endPointer);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('dblclick', onDoubleClick);

    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', endPointer);
      el.removeEventListener('pointercancel', endPointer);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('dblclick', onDoubleClick);
    };
  }, [areaRef, onChange]);

  return { stateRef, elementRef };
}
