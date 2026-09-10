# Pulseboard

A real-time telemetry dashboard that renders 100k+ live data points at 60fps
without a charting library. Everything — line charts, bar chart, scatter
plot, heatmap — is drawn by hand on canvas.

**Live:** https://pulseboard-one-kappa.vercel.app/dashboard

## What it does

Simulates six machine sensors (inlet pressure, coolant temperature, spindle
load, vibration, flow rate, power draw) ticking in at 10 times a second, and
visualizes all of it live:

- **Line charts** for each sensor, with zoom (Ctrl/Cmd + scroll), pan (drag),
  and a hover crosshair
- **Bar chart** showing a time-bucketed average of one sensor
- **Scatter plot** correlating two sensors against each other, colour-coded
  by which one is in a worse status at that instant
- **Heatmap** — all six sensors as rows, time as columns, each cell coloured
  by how hot that sensor is relative to its *own* range (a 240 kPa pressure
  swing and a 2 mm/s vibration swing aren't the same number, so each row
  normalizes independently)
- **Virtualized data table** of raw ticks — handles 100k+ rows by only ever
  keeping ~25 DOM row elements around, repositioned as you scroll
- Filter panel to show/hide sensors, time-range presets (30s to All), and a
  manual aggregation override (auto / 1min / 5min / 1hour buckets)
- A live performance monitor — FPS, frame time, draw cost, buffer memory —
  plus controls to crank up the data rate or buffer size and watch it hold

Full writeup of how it stays at 60fps, with real production benchmarks, is in
[PERFORMANCE.md](./PERFORMANCE.md).

## Stack

Next.js 16 (App Router), TypeScript (strict), Canvas 2D + SVG hybrid
rendering, a Web Worker for data generation. No chart library — decimation,
axes, gridlines, and the heatmap's colour ramp are all hand-rolled. No
external state library either; the tick data lives in typed-array ring
buffers outside React entirely, not in `useState`.

## Running it locally

```bash
git clone https://github.com/shreyaa-hub/Pulseboard.git
cd Pulseboard
npm install
npm run dev
```

Open `http://localhost:3000/dashboard` — the root `/` is just the default
Next.js starter page, unused.

For real performance numbers, dev mode isn't representative (React strict
mode double-renders, nothing's minified). Use:

```bash
npm run build
npm start
```

## Browser support

Built and tested in Chrome. Should work in any browser with Canvas 2D,
Web Worker, and `ResizeObserver` support — so current Firefox and Safari as
well — but I've only actually verified it in Chrome.

## Project structure

```
lib/            ring buffer, data generator, decimation, aggregation,
                canvas helpers, viewport math — all framework-agnostic
hooks/          wiring canvas components to the shared rAF loop, pan/zoom
                interaction, the global time-range sync
components/
  charts/       LineChart, BarChart, ScatterChart, HeatmapChart, AxisLayer
  controls/     FilterPanel, TimeRangeSelector
  providers/    DataProvider — owns the store, the worker, and shared UI state
  ui/           DataTable, PerformanceMonitor
workers/        the tick generator, running off the main thread
app/dashboard/  the actual route — server component seeds the initial data
```

## What I'd do next

- A stress-test mode past 50 points/tick in the UI (the architecture handles
  it, there's just no button for it yet)
- Real device testing — everything here was checked in Chrome's device
  emulation, not an actual phone
- Bundle size and Core Web Vitals numbers
