import React, { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';

import './ChargingHistoryChart.css';

const PAD_LEFT = 34;
const PAD_RIGHT = 10;
const PAD_TOP = 14;
const PAD_BOTTOM = 28;

// Fallback viewBox width used only for the very first render, before the
// ResizeObserver below reports the container's real size.
const INITIAL_VIEW_WIDTH = 340;

// Zoom/pan bounds: never let the visible window collapse to less than 1% of
// the full session span (or 60s, whichever's bigger) - past that there's
// nothing meaningful left for a drag/pinch to reveal.
const MIN_VISIBLE_FRACTION = 0.01;
const MIN_VISIBLE_SECONDS = 60;
const WHEEL_ZOOM_STEP = 1.25; // one wheel notch = 25% in/out

/**
 * Step chart of offered vs. used current (A) over time, built from a
 * charger's `charging_history` entries ({ timestamp, offered, usage }).
 *
 * Deliberately takes only that raw array (plus an optional height/unit) so
 * it can be reused as-is for a live session (DialComponent) or a historic
 * session lookup later - no fetching or session-specific logic lives here.
 *
 * The x-axis is zoomable/pannable (mouse wheel/trackpad scroll, touch
 * pinch/drag) so a brief spike is inspectable even in a session that spans
 * hours - see `viewRange`/`applyRange` below. The y-axis intentionally stays
 * fixed to the full session's own max, so zooming in on time doesn't also
 * rescale the current axis underneath you.
 *
 * A plain mouse only ever reports vertical wheel deltas, but a trackpad's
 * two-finger scroll reports both deltaX and deltaY - often comparable in
 * size even for a swipe the user intends as purely vertical, since
 * fingers rarely move in a perfectly straight line. Trying to route
 * "mostly horizontal" scroll to panning (instead of zooming) turned out to
 * misfire constantly on real trackpads. So: any wheel/scroll gesture zooms,
 * using whichever axis moved more to read the direction; panning is drag
 * (mouse or touch) and pinch only.
 *
 * Zoom state is owned here, but a caller can observe/control it via
 * `onZoomChange` and the imperative `resetZoom()` ref method - e.g. so the
 * modal wrapping this chart can render its own "Reset zoom" button in a
 * fixed-size header instead of inside this component's own layout, which
 * would otherwise resize the surrounding modal as that button appears.
 */
const ChargingHistoryChart = forwardRef(function ChargingHistoryChart(
  { history, height = 220, unit = 'A', onZoomChange },
  ref,
) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const clipId = useId();
  // The viewBox width is kept equal to the container's actual rendered
  // pixel width (via ResizeObserver) rather than a fixed guess. SVG text
  // scales with the ratio of rendered size to viewBox size, so any mismatch
  // there shows up as text that's too small (viewBox too big for a narrow
  // phone) or - as reported from the wide desktop modal - way too large,
  // with the chart itself stretched into a tall, mostly-empty column
  // (this used to also drive the SVG's on-screen *height* via a CSS
  // `height: auto` aspect-ratio lock; that's removed too, in
  // ChargingHistoryChart.css, so height is simply whatever this component
  // is asked to render at, independent of width).
  const [viewWidth, setViewWidth] = useState(INITIAL_VIEW_WIDTH);
  // null = "live": show the full available range, tracking new data as it
  // arrives. Set to a {start, end} timestamp window once the user zooms or
  // pans; resets to null (see applyRange) once that window is widened back
  // out to cover the whole dataset, so it resumes auto-tracking rather than
  // freezing at whatever the full range happened to be at that moment.
  const [viewRange, setViewRange] = useState(null);
  const isZoomed = viewRange !== null;

  // Active pointers (mouse or touch) keyed by pointerId -> clientX, and the
  // gesture (pan or pinch) computed from however many are currently down -
  // same window-listener pattern as ChargingDial's drag handling.
  const pointersRef = useRef(new Map());
  const gestureRef = useRef(null);

  // All hooks below run on every render regardless of the "not enough data"
  // early return further down, to satisfy React's rules of hooks - each
  // effect guards internally against the DOM node it needs not existing yet.

  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width;
      if (width && width > 0) {
        setViewWidth(width);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    onZoomChange?.(isZoomed);
  }, [isZoomed, onZoomChange]);

  useImperativeHandle(ref, () => ({
    resetZoom: () => setViewRange(null),
  }));

  // Wheel needs a real (non-passive) listener so preventDefault actually
  // stops the page from scrolling while zooming - React's onWheel prop is
  // passive by default and can't do that. Re-attached every render so the
  // handler always closes over the latest domain/scale values (handleWheel
  // is defined further down, but as a function declaration it's hoisted and
  // already callable here); add/remove is cheap enough that this doesn't
  // need memoizing.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) {
      return undefined;
    }
    svg.addEventListener('wheel', handleWheel, { passive: false });
    return () => svg.removeEventListener('wheel', handleWheel);
  });

  const points = normalizeHistory(history);

  if (points.length < 2) {
    return (
      <div ref={containerRef} className="inline-state">
        Not enough data yet to plot a graph.
      </div>
    );
  }

  const plotWidth = viewWidth - PAD_LEFT - PAD_RIGHT;
  const plotHeight = height - PAD_TOP - PAD_BOTTOM;

  const minTs = points[0].timestamp;
  const maxTs = points[points.length - 1].timestamp;
  const fullSpan = Math.max(maxTs - minTs, 1);
  const minVisibleSpan = Math.min(fullSpan, Math.max(MIN_VISIBLE_SECONDS, fullSpan * MIN_VISIBLE_FRACTION));

  const domainStart = viewRange ? viewRange.start : minTs;
  const domainEnd = viewRange ? viewRange.end : maxTs;
  const domainSpan = Math.max(domainEnd - domainStart, 1);

  const maxValue = Math.max(
    6,
    ...points.map((p) => Math.max(p.offered ?? 0, p.usage ?? 0)),
  );

  const xScale = (ts) => PAD_LEFT + ((ts - domainStart) / domainSpan) * plotWidth;
  const yScale = (value) => PAD_TOP + (1 - value / maxValue) * plotHeight;

  const offeredPath = buildStepPath(points, 'offered', xScale, yScale, PAD_LEFT + plotWidth);
  const usagePath = buildStepPath(points, 'usage', xScale, yScale, PAD_LEFT + plotWidth);
  const usageAreaPath = usagePath ? `${usagePath} L ${PAD_LEFT + plotWidth} ${yScale(0)} L ${PAD_LEFT} ${yScale(0)} Z` : null;

  const yTicks = buildYTicks(maxValue);
  const xTicks = buildXTicks(domainStart, domainEnd);

  // Clamps a candidate {start, end} window to the data's actual range,
  // preserving span where possible - only shrinking it against the min
  // span, or sliding it back if it would run past an edge.
  function clampRange(start, end) {
    let span = Math.min(end - start, fullSpan);
    span = Math.max(span, minVisibleSpan);
    let nextStart = start;
    let nextEnd = nextStart + span;
    if (nextStart < minTs) {
      nextStart = minTs;
      nextEnd = nextStart + span;
    }
    if (nextEnd > maxTs) {
      nextEnd = maxTs;
      nextStart = nextEnd - span;
    }
    return { start: Math.max(nextStart, minTs), end: Math.min(nextEnd, maxTs) };
  }

  function applyRange(start, end) {
    const clamped = clampRange(start, end);
    if (clamped.start <= minTs && clamped.end >= maxTs) {
      setViewRange(null);
    } else {
      setViewRange(clamped);
    }
  }

  function clientXToTimestamp(clientX) {
    const rect = svgRef.current.getBoundingClientRect();
    const fraction = (clientX - rect.left - PAD_LEFT) / plotWidth;
    return domainStart + fraction * domainSpan;
  }

  function handleWheel(event) {
    event.preventDefault();
    const anchorTs = clientXToTimestamp(event.clientX);
    // Whichever axis moved more carries the gesture's intended direction -
    // see the file-level comment on why both axes always zoom rather than
    // treating a horizontal-dominant scroll as a pan.
    const primaryDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    const factor = primaryDelta < 0 ? 1 / WHEEL_ZOOM_STEP : WHEEL_ZOOM_STEP;
    const newSpan = Math.min(fullSpan, Math.max(minVisibleSpan, domainSpan * factor));
    const anchorFraction = (anchorTs - domainStart) / domainSpan;
    const newStart = anchorTs - anchorFraction * newSpan;
    applyRange(newStart, newStart + newSpan);
  }

  // (Re)computes the active gesture's baseline from the pointers currently
  // down - called on every pointerdown/pointerup so e.g. lifting one finger
  // during a pinch smoothly falls back to a single-finger pan instead of
  // jumping.
  function startGesture() {
    const xs = [...pointersRef.current.values()];
    if (xs.length >= 2) {
      gestureRef.current = {
        mode: 'pinch',
        startDist: Math.abs(xs[0] - xs[1]) || 1,
        anchorTs: clientXToTimestamp((xs[0] + xs[1]) / 2),
        startDomainStart: domainStart,
        startDomainSpan: domainSpan,
      };
    } else if (xs.length === 1) {
      gestureRef.current = {
        mode: 'pan',
        startX: xs[0],
        startDomainStart: domainStart,
        startDomainEnd: domainEnd,
      };
    } else {
      gestureRef.current = null;
    }
  }

  function handlePointerMove(event) {
    if (!pointersRef.current.has(event.pointerId)) {
      return;
    }
    pointersRef.current.set(event.pointerId, event.clientX);
    const gesture = gestureRef.current;
    if (!gesture) {
      return;
    }

    if (gesture.mode === 'pan') {
      const deltaPx = event.clientX - gesture.startX;
      const deltaTs = -(deltaPx / plotWidth) * (gesture.startDomainEnd - gesture.startDomainStart);
      applyRange(gesture.startDomainStart + deltaTs, gesture.startDomainEnd + deltaTs);
      return;
    }

    const xs = [...pointersRef.current.values()];
    if (xs.length < 2) {
      return;
    }
    const dist = Math.abs(xs[0] - xs[1]) || 1;
    const ratio = dist / gesture.startDist;
    const newSpan = Math.min(fullSpan, Math.max(minVisibleSpan, gesture.startDomainSpan / ratio));
    const anchorFraction = (gesture.anchorTs - gesture.startDomainStart) / gesture.startDomainSpan;
    const newStart = gesture.anchorTs - anchorFraction * newSpan;
    applyRange(newStart, newStart + newSpan);
  }

  function endPointer(event) {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size === 0) {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', endPointer);
      window.removeEventListener('pointercancel', endPointer);
      gestureRef.current = null;
    } else {
      startGesture();
    }
  }

  function handlePointerDown(event) {
    const wasEmpty = pointersRef.current.size === 0;
    pointersRef.current.set(event.pointerId, event.clientX);
    startGesture();
    if (wasEmpty) {
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', endPointer);
      window.addEventListener('pointercancel', endPointer);
    }
  }

  return (
    <div className="charging-history-chart" ref={containerRef}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${viewWidth} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={handlePointerDown}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={PAD_LEFT} y={PAD_TOP} width={Math.max(plotWidth, 0)} height={Math.max(plotHeight, 0)} />
          </clipPath>
        </defs>

        {yTicks.map((tick) => (
          <g key={`y-${tick}`}>
            <line
              className="chart-gridline"
              x1={PAD_LEFT}
              x2={PAD_LEFT + plotWidth}
              y1={yScale(tick)}
              y2={yScale(tick)}
            />
            <text className="chart-axis-label" x={PAD_LEFT - 8} y={yScale(tick)} textAnchor="end" dominantBaseline="middle">
              {tick}
            </text>
          </g>
        ))}

        {xTicks.map((tick) => (
          <text
            key={`x-${tick.timestamp}`}
            className="chart-axis-label"
            x={xScale(tick.timestamp)}
            y={height - PAD_BOTTOM + 16}
            textAnchor="middle"
          >
            {tick.label}
          </text>
        ))}

        <g clipPath={`url(#${clipId})`}>
          {usageAreaPath ? <path className="chart-area chart-area-usage" d={usageAreaPath} /> : null}
          {offeredPath ? <path className="chart-line chart-line-offered" d={offeredPath} /> : null}
          {usagePath ? <path className="chart-line chart-line-usage" d={usagePath} /> : null}
        </g>
      </svg>

      <div className="chart-legend">
        <span className="chart-legend-item">
          <span className="chart-swatch chart-swatch-offered" /> Offered ({unit})
        </span>
        <span className="chart-legend-item">
          <span className="chart-swatch chart-swatch-usage" /> Usage ({unit})
        </span>
      </div>
      <p className="chart-hint">Scroll to zoom, drag to pan</p>
    </div>
  );
});

export default ChargingHistoryChart;

function normalizeHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  const points = history
    .filter((entry) => entry && Number.isFinite(Number(entry.timestamp)))
    .map((entry) => ({
      timestamp: Number(entry.timestamp),
      offered: entry.offered === null || entry.offered === undefined ? null : Number(entry.offered),
      usage: entry.usage === null || entry.usage === undefined ? null : Number(entry.usage),
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

  // Extend the last known values to "now" so the last step isn't cut off mid-air.
  if (points.length > 0) {
    const last = points[points.length - 1];
    const nowSeconds = Date.now() / 1000;
    if (nowSeconds - last.timestamp > 1) {
      points.push({ timestamp: nowSeconds, offered: last.offered, usage: last.usage });
    }
  }

  return points;
}

// Builds a stepAfter path: the value holds flat until the next timestamp,
// then jumps - matching how offers/usage actually change in Balanz. Points
// outside the visible domain are included too (their coordinates just land
// outside the plot rect) so the line still enters/exits the frame correctly
// at the edges instead of appearing to start/end mid-air - the clipPath in
// the render above trims the excess.
function buildStepPath(points, key, xScale, yScale, rightEdgeX) {
  const known = points.filter((p) => p[key] !== null);
  if (known.length === 0) {
    return null;
  }

  let d = `M ${xScale(known[0].timestamp)} ${yScale(known[0][key])}`;
  let prevY = yScale(known[0][key]);

  for (let i = 1; i < known.length; i += 1) {
    const x = xScale(known[i].timestamp);
    const y = yScale(known[i][key]);
    d += ` L ${x} ${prevY} L ${x} ${y}`;
    prevY = y;
  }

  d += ` L ${rightEdgeX} ${prevY}`;
  return d;
}

function buildYTicks(maxValue) {
  const step = Math.ceil(maxValue / 4);
  const ticks = [];
  for (let value = 0; value <= maxValue; value += step) {
    ticks.push(value);
  }
  return ticks;
}

function buildXTicks(domainStart, domainEnd) {
  const count = 5;
  const step = (domainEnd - domainStart) / (count - 1);
  const ticks = [];
  for (let i = 0; i < count; i += 1) {
    const timestamp = domainStart + step * i;
    ticks.push({ timestamp, label: formatTime(timestamp) });
  }
  return ticks;
}

function formatTime(timestampSeconds) {
  const date = new Date(timestampSeconds * 1000);
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}
