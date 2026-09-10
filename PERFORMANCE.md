# PERFORMANCE.md

Numbers below are from the deployed production build on Vercel
(`pulseboard-one-kappa.vercel.app/dashboard`), not `npm run dev`. Dev mode
double-renders under React strict mode and skips minification, so its numbers
are meaningfully worse and I didn't want to report them as if they were real.

Test machine: MacBook Air, Chrome. Six sensor series, one line chart each,
plus a bar chart, a scatter plot, and a heatmap all reading from the same six
buffers concurrently — so these numbers include the cost of everything on the
page at once, not one chart in isolation.

## Benchmark results

| Points/tick | Points held | Arrival rate | FPS | Frame time (95th) | Draw cost | Memory |
|---|---|---|---|---|---|---|
| 1 (default) | 3,792 | 72/s | 60 | 16.8 ms | 0.81 ms | 1.5 MB |
| 5 | 7,728 | 240/s | 60 | 16.8 ms | 1.52 ms | 1.5 MB |
| 20 | 24,018 | 1,438/s | 60 | 16.8 ms | 1.48 ms | 1.5 MB |
| 50 | 48,654 | 2,361/s | 60 | 17.7 ms | 1.67 ms | 1.5 MB |
| 50 + 100k buffer | 73,800 | 2,374/s | 60 | 17.7 ms | 2.25 ms | 7.4 MB |
| 50 + 100k, paused | 159,300 | 0/s | 60 | 17.6 ms | 2.95 ms | 7.4 MB |

60fps held at every single one of these, including the heaviest case tested:
50 points/tick across 6 series is 2,374 points/second arriving continuously,
with 159,300 points already sitting in the buffers being redrawn every frame.
16.7ms is the actual budget for 60fps; the worst frame time observed was
17.7ms, which is close enough that a slower machine than mine would probably
start dropping the odd frame there, but the target itself was met on every
level.

The thing I think is actually interesting here, more than "it holds 60fps":
**draw cost barely moves with arrival rate, but does move with total points
held.** Going from 1 to 50 points/tick (a 33x increase in how fast data
arrives) only took draw cost from 0.81ms to 1.67ms. But look at the paused
row — with the feed stopped entirely (0 points/s arriving), draw cost is
still 2.95ms, higher than any of the streaming rows, because there are now
159,300 points sitting in the buffer that every chart has to decimate down to
screen resolution on every single frame regardless of whether anything new
came in. The cost is dominated by "how much history is on screen," not "how
fast is data arriving." That's the whole point of doing decimation on every
frame instead of only when new data arrives — it means panning around old
history costs the same as watching live data, instead of getting slower the
longer the buffer's been running.

## Why the numbers look like this

**Decimation, not brute force.** None of the line charts ever draw more
points than roughly one per horizontal pixel. A chart that's 900px wide
draws at most ~1,800 points regardless of whether the buffer behind it holds
50,000 or 500,000 — min/max decimation picks the highest and lowest value in
each pixel-wide column of time, so spikes never get lost, but the actual
number of `lineTo` calls per frame is bounded by screen width, not data
volume. This is the reason draw cost only went from 0.81ms to 2.95ms (about
3.6x) while the data held went up by roughly 42x (3,792 → 159,300).

**Data lives outside React entirely.** Every tick point sits in a
`Float64Array`/`Float32Array`/`Uint8Array` triplet — a ring buffer, not a
JS array of objects, and definitely not React state. At 10 ticks/second
across 6 series, routing that through `setState` would mean the whole chart
tree re-rendering 60 times a second just to move data around before a single
pixel gets drawn. Instead there's one shared `requestAnimationFrame` loop
that every chart registers a draw callback with, and each callback reads
straight from the buffers. React only ever sees a handful of things: the FPS
counter, the "points held" readout, and the crosshair value on hover — all
throttled to a few times a second, because nobody can read a number changing
faster than that anyway.

**Memory is flat and I checked the actual math against what the browser
reports, not just eyeballed it.** Each point costs exactly 13 bytes
(8-byte timestamp + 4-byte value + 1-byte status flag), fixed capacity,
allocated once. At the default 20,000-point buffer × 6 series that's
`13 × 20,000 × 6 = 1,560,000 bytes`, which is 1.49 MB — the browser reports
1.5 MB. At 100,000 capacity it's 7.44 MB calculated, 7.4 MB reported. Those
aren't close, they're the same number, which is what "no memory leak" should
actually look like: not "grows slowly," but "doesn't grow at all," because
raising the buffer size rebuilds the arrays at the new fixed size rather than
letting them grow unbounded. Notice in the table that memory stayed at
exactly 1.5 MB across four completely different arrival rates (72/s all the
way to 2,361/s) — rate has nothing to do with memory here, only capacity
does.

**Web Worker for generation.** Tick data is generated in a worker and handed
to the main thread as a transferable `ArrayBuffer`, not structured-cloned.
The main thread never blocks on data generation even at 50 points/tick,
which is part of why draw cost tracks buffer size and not arrival rate — the
main thread's only job is drawing, never computing the next value.

## What I found and had to fix along the way

**The data table crushed to unreadable slivers on a narrow screen, silently.**
Six sensor columns as `flex: 1` cells don't fail loudly on mobile — they just
shrink to a few pixels each and truncate to nothing, which looks fine in a
glance and is useless in actual use. Fixed by giving the table row a real
computed minimum width and letting the container scroll horizontally instead,
with the header pinned via `position: sticky` so column names stay visible
while scrolling down.

**A sensor's random walk could get stuck flat-lined near its floor.**
Vibration's baseline sits close to its minimum, and a downward "excursion"
(the anomaly injection meant to simulate a fault event) could push the walk's
target value straight into the hard clamp, producing a visibly flat line for
a few hundred points instead of the noisy trace every other excursion looks
like. Caught it by checking how often generated values actually touched
either rail — about 650 points out of 50,000 for vibration specifically,
versus 2-6 for every other sensor. Fixed by keeping the walk's target inside
a 5% margin of the sensor's real range instead of letting it aim at the
absolute limit.

**Trackpad scroll and page scroll were fighting each other.** Wheel events
were wired to zoom, which meant an ordinary two-finger scroll anywhere over a
chart got eaten instead of scrolling the page — you couldn't scroll past a
chart at all. Fixed by requiring Ctrl/Cmd to be held before a wheel event
zooms anything. Genuine pinch-to-zoom on a trackpad still works without
needing to explicitly hold anything, because browsers already mark real
pinch gestures with `ctrlKey: true` on the wheel event — that's a existing
browser convention, not something I had to detect myself.

## What I didn't get to

- No mobile device testing beyond Chrome's device emulation — I don't have
  an Android phone handy, and haven't tested on an actual iPhone.
- Bundle size / Core Web Vitals weren't measured — would want Lighthouse
  numbers here if I had more time.
- 50,000 and 100,000 points/tick weren't tested (only buffer *size* was
  pushed to 100k, not tick rate past 50) — the app doesn't have a UI control
  past 50, and I ran out of time to add a stress-test-only override before
  submission.
- The pause/resume test only confirms FPS holds at 60 with zero new data;
  I didn't specifically measure how long a resume takes to catch back up
  after being paused for an extended period.
