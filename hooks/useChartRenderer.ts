'use client';

import { useCallback, useEffect, useRef } from 'react';
import { currentDpr, syncCanvasSize, type CanvasSize } from '@/lib/canvasUtils';
import type { FrameInfo, RafDriver } from '@/lib/rafDriver';

export type DrawFn = (
  ctx: CanvasRenderingContext2D,
  size: CanvasSize,
  frame: FrameInfo,
  resized: boolean,
) => void;

interface Options {
  /**
   * Draw every frame. True for anything showing live data; false for charts
   * that only change on interaction, which then redraw via invalidate().
   */
  continuous?: boolean;
}

/**
 * Connects one canvas to the shared rAF loop.
 *
 * The draw function is held in a ref and re-read each frame, so it can close
 * over current props without the effect tearing down and re-registering on
 * every render. Passing `draw` in the dependency array instead would
 * unregister and re-register the callback several times a second.
 */
export function useChartRenderer(
  driver: RafDriver,
  draw: DrawFn,
  { continuous = true }: Options = {},
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const sizeRef = useRef<CanvasSize>({ width: 0, height: 0, dpr: 1 });
  const drawRef = useRef(draw);
  const dirtyRef = useRef(true);

  drawRef.current = draw;

  const invalidate = useCallback(() => {
    dirtyRef.current = true;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const parent = canvas.parentElement;
    if (!parent) return;

    // alpha:false lets the compositor skip blending the canvas with what is
    // behind it. Measurably cheaper per frame on large canvases, at the cost
    // of the chart needing to paint its own background.
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    ctxRef.current = ctx;

    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      sizeRef.current = {
        width: Math.max(1, box.width),
        height: Math.max(1, box.height),
        dpr: currentDpr(),
      };
      dirtyRef.current = true;
    });
    observer.observe(parent);

    const rect = parent.getBoundingClientRect();
    sizeRef.current = {
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
      dpr: currentDpr(),
    };

    // Moving the window to a monitor with a different pixel ratio fires this
    // and nothing else; without it the canvas stays at the old ratio and
    // goes soft.
    const dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const onDprChange = () => {
      sizeRef.current = { ...sizeRef.current, dpr: currentDpr() };
      dirtyRef.current = true;
    };
    dprQuery.addEventListener('change', onDprChange);

    const unregister = driver.register((frame: FrameInfo) => {
      const c = canvasRef.current;
      const context = ctxRef.current;
      if (!c || !context) return;

      const resized = syncCanvasSize(c, context, sizeRef.current);
      if (!continuous && !dirtyRef.current && !resized) return;
      dirtyRef.current = false;

      drawRef.current(context, sizeRef.current, frame, resized);
    });

    return () => {
      unregister();
      observer.disconnect();
      dprQuery.removeEventListener('change', onDprChange);
      ctxRef.current = null;
    };
  }, [driver, continuous]);

  return { canvasRef, invalidate, sizeRef };
}
