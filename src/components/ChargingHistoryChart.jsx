import React, { useEffect, useRef, useState } from 'react';

import './ChargingHistoryChart.css';

const PAD_LEFT = 34;
const PAD_RIGHT = 10;
const PAD_TOP = 14;
const PAD_BOTTOM = 28;

// Fallback viewBox width used only for the very first render, before the
// ResizeObserver below reports the container's real size.
const INITIAL_VIEW_WIDTH = 340;

/**
 * Step chart of offered vs. used current (A) over time, built from a
 * charger's `charging_history` entries ({ timestamp, offered, usage }).
 *
 * Deliberately takes only that raw array (plus an optional height/unit) so
 * it can be reused as-is for a live session (DialComponent) or a historic
 * session lookup later - no fetching or session-specific logic lives here.
 */
export default function ChargingHistoryChart({ history, height = 220, unit = 'A' }) {
  const containerRef = useRef(null);
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
  const tsSpan = Math.max(maxTs - minTs, 1);

  const maxValue = Math.max(
    6,
    ...points.map((p) => Math.max(p.offered ?? 0, p.usage ?? 0)),
  );

  const xScale = (ts) => PAD_LEFT + ((ts - minTs) / tsSpan) * plotWidth;
  const yScale = (value) => PAD_TOP + (1 - value / maxValue) * plotHeight;

  const offeredPath = buildStepPath(points, 'offered', xScale, yScale, PAD_LEFT + plotWidth);
  const usagePath = buildStepPath(points, 'usage', xScale, yScale, PAD_LEFT + plotWidth);
  const usageAreaPath = usagePath ? `${usagePath} L ${PAD_LEFT + plotWidth} ${yScale(0)} L ${PAD_LEFT} ${yScale(0)} Z` : null;

  const yTicks = buildYTicks(maxValue);
  const xTicks = buildXTicks(points, xScale);

  return (
    <div className="charging-history-chart" ref={containerRef}>
      <svg viewBox={`0 0 ${viewWidth} ${height}`} width="100%" height={height} preserveAspectRatio="xMidYMid meet">
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

        {usageAreaPath ? <path className="chart-area chart-area-usage" d={usageAreaPath} /> : null}
        {offeredPath ? <path className="chart-line chart-line-offered" d={offeredPath} /> : null}
        {usagePath ? <path className="chart-line chart-line-usage" d={usagePath} /> : null}
      </svg>

      <div className="chart-legend">
        <span className="chart-legend-item">
          <span className="chart-swatch chart-swatch-offered" /> Offered ({unit})
        </span>
        <span className="chart-legend-item">
          <span className="chart-swatch chart-swatch-usage" /> Usage ({unit})
        </span>
      </div>
    </div>
  );
}

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
// then jumps - matching how offers/usage actually change in Balanz.
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

function buildXTicks(points, xScale) {
  const count = Math.min(5, points.length);
  if (count <= 1) {
    return points.map((p) => ({ timestamp: p.timestamp, label: formatTime(p.timestamp) }));
  }

  const first = points[0].timestamp;
  const last = points[points.length - 1].timestamp;
  const step = (last - first) / (count - 1);
  const ticks = [];
  for (let i = 0; i < count; i += 1) {
    const timestamp = first + step * i;
    ticks.push({ timestamp, label: formatTime(timestamp) });
  }
  return ticks;
}

function formatTime(timestampSeconds) {
  const date = new Date(timestampSeconds * 1000);
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}
