'use client';

import { useEffect, useRef } from 'react';
import type { PlotArea } from '@/lib/viewport';

export interface ScatterDomain {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface ScatterInteractionState {
  domain: ScatterDomain;
  hoverX: number;
  hoverY: number;
  dragging: boolean;
}

/**
 * The line/bar interaction hook (useChartInteraction) assumes the x-axis is
 * time — it zooms with a minimum span in milliseconds and follows a live
 * edge. Scatter's x-axis is another sensor's value, so neither of those makes
 * sense here: there's no "live edge" to follow and no reason to floor the
 * zoom at 500ms. This is a separate, smaller hook rather than overloading the
 * time one with a mode flag.
 */
export function useScatterInteraction(initial: ScatterDomain, areaRef: React.RefObject<PlotArea>) {
  const stateRef = useRef<ScatterInteractionState>({
    domain: initial,
    hoverX: -1,
    hoverY: -1,
    dragging: false,
  });
  const elementRef = useRef<HTMLDivElement | null>(null);
  const initialRef = useRef(initial);
  initialRef.current = initial;

  useEffect(() => {
    const el = elementRef.current;
    if (!el) return;

    const s = stateRef.current;
    let lastX = 0;
    let lastY = 0;

    const onWheel = (e: WheelEvent) => {
      const area = areaRef.current;
      if (!area) return;
      e.preventDefault();

      const rect = el.getBoundingClientRect();
      const anchorX = Math.min(1, Math.max(0, (e.clientX - rect.left - area.left) / area.width));
      const anchorY = Math.min(
        1,
        Math.max(0, 1 - (e.clientY - rect.top - area.top) / area.height),
      );

      const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const factor = Math.exp(px * 0.0015);

      const d = s.domain;
      const xSpan = (d.xMax - d.xMin) * factor;
      const ySpan = (d.yMax - d.yMin) * factor;
      const xPivot = d.xMin + (d.xMax - d.xMin) * anchorX;
      const yPivot = d.yMin + (d.yMax - d.yMin) * anchorY;

      s.domain = {
        xMin: xPivot - xSpan * anchorX,
        xMax: xPivot + xSpan * (1 - anchorX),
        yMin: yPivot - ySpan * anchorY,
        yMax: yPivot + ySpan * (1 - anchorY),
      };
    };

    const onPointerDown = (e: PointerEvent) => {
      s.dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      const area = areaRef.current;
      if (!area) return;

      const rect = el.getBoundingClientRect();
      s.hoverX = e.clientX - rect.left;
      s.hoverY = e.clientY - rect.top;

      if (s.dragging) {
        const dxPx = e.clientX - lastX;
        const dyPx = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;

        const d = s.domain;
        const xPerPx = (d.xMax - d.xMin) / area.width;
        const yPerPx = (d.yMax - d.yMin) / area.height;
        s.domain = {
          xMin: d.xMin - dxPx * xPerPx,
          xMax: d.xMax - dxPx * xPerPx,
          // Screen y grows downward, data y grows upward — signs flip.
          yMin: d.yMin + dyPx * yPerPx,
          yMax: d.yMax + dyPx * yPerPx,
        };
      }
    };

    const endPointer = (e: PointerEvent) => {
      s.dragging = false;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };

    const onLeave = () => {
      s.hoverX = -1;
      s.hoverY = -1;
    };

    const onDoubleClick = () => {
      s.domain = { ...initialRef.current };
    };

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
  }, [areaRef]);

  return { stateRef, elementRef };
}
