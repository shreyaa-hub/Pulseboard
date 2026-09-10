import { DataGenerator } from '@/lib/dataGenerator';
import type { TickBatch } from '@/lib/types';

export type WorkerIn =
  | { type: 'start'; startTime: number; intervalMs: number; pointsPerTick: number; seed: number }
  | { type: 'rate'; pointsPerTick: number }
  | { type: 'pause'; paused: boolean }
  | { type: 'stop' };

export type WorkerOut = { type: 'batch'; batches: TickBatch[] };

let gen: DataGenerator | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let paused = false;

function stop() {
  if (timer !== null) clearInterval(timer);
  timer = null;
  gen = null;
}

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;

  if (msg.type === 'start') {
    stop();
    gen = new DataGenerator(msg.startTime, {
      seed: msg.seed,
      intervalMs: msg.intervalMs,
      pointsPerTick: msg.pointsPerTick,
    });

    timer = setInterval(() => {
      if (!gen || paused) return;
      const batches = gen.tick();

      // Transferring hands the underlying buffers to the main thread instead
      // of structured-cloning them. At 10 batches a second the copy would be
      // small, but the transfer is what makes raising pointsPerTick to
      // stress-test levels stay free.
      const transfer: Transferable[] = [];
      for (const b of batches) {
        transfer.push(b.t.buffer as ArrayBuffer, b.v.buffer as ArrayBuffer, b.status.buffer as ArrayBuffer);
      }
      (self as unknown as Worker).postMessage({ type: 'batch', batches }, transfer);
    }, msg.intervalMs);
    return;
  }

  if (msg.type === 'rate' && gen) {
    gen.pointsPerTick = msg.pointsPerTick;
    return;
  }

  if (msg.type === 'pause') {
    paused = msg.paused;
    return;
  }

  if (msg.type === 'stop') stop();
};
