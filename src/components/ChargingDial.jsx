import React, { useRef } from 'react';

import './ChargingDial.css';

const SIZE = 220;
const STROKE = 12;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// The draggable handle's *visual* radius - its own geometry (r below) plus
// half of its stroke-width, since SVG strokes are centered on the path and
// so extend r further outward - is bigger than the ring's own half-stroke,
// and the ring is drawn flush with the SVG's edges. Without this margin, the
// handle sticks out past the viewBox (and gets clipped) at the
// top/bottom/left/right points where it sits exactly on the ring.
// HANDLE_STROKE must match .charging-dial-handle's stroke-width in
// ChargingDial.css.
const HANDLE_RADIUS = STROKE * 0.9;
const HANDLE_STROKE = 3;
const HANDLE_VISUAL_RADIUS = HANDLE_RADIUS + HANDLE_STROKE / 2;
// Padding the viewBox, and the CSS box by the same amount (see
// ChargingDial.css), keeps the ring itself rendered at the same size while
// giving the handle room - plus a couple px of buffer for antialiasing.
const HANDLE_PADDING = Math.ceil(HANDLE_VISUAL_RADIUS - STROKE / 2) + 2;
const VIEWBOX_SIZE = SIZE + HANDLE_PADDING * 2;
const CENTER = VIEWBOX_SIZE / 2;

/**
 * A circular ring gauge for a single charger connector.
 *
 * The ring's fill fraction (and, when interactive, its handle position)
 * always reflects offered current vs. the charger's max (conn_max) - the
 * same metric balanz-ui's own group-level Gauge uses, a real backend-sourced
 * number rather than an invented percentage.
 *
 * When `interactive` is set (direct current-limit control is allowed for
 * this charger/user - see DialComponent), the ring doubles as the control
 * itself: dragging anywhere on it (mouse or touch, via Pointer Events) moves
 * a handle dot around the circle. onInteractiveChange fires continuously
 * during the drag (so the ring/handle track the pointer live), while
 * onInteractiveCommit fires once, with the final value, when the pointer is
 * released - that's the caller's cue to actually apply the change, rather
 * than firing a backend call on every intermediate pointermove tick.
 * Deliberately no keyboard support here: arrow-key stepping would need its
 * own commit-on-release-equivalent (e.g. a debounce) to avoid applying a
 * change per keypress, which is more complexity than this control needs.
 *
 * The center of the ring is a small stack of live readings - status/network
 * badges, headline current usage + estimated power, and the offered
 * current - independent of the ring's own fraction/handle.
 */
export default function ChargingDial({
  value,
  max,
  badges = [],
  primaryValue,
  primaryUnit,
  secondaryValue,
  secondaryUnit,
  footerLabel,
  footerValue,
  footerUnit,
  tone = 'tone-neutral',
  interactive = false,
  interactiveMin = 0,
  onInteractiveChange,
  onInteractiveCommit,
}) {
  const svgRef = useRef(null);
  const draggingRef = useRef(false);
  // Tracks the most recently computed value across a drag so stopDragging()
  // (a closure captured once, at pointerdown time) can report the *final*
  // value to onInteractiveCommit - reading a value passed down via props
  // instead would be stale, since those props only update on next render.
  const lastValueRef = useRef(null);

  const safeMax = Number(max) > 0 ? Number(max) : 0;
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  const fraction = safeMax > 0 ? Math.min(1, safeValue / safeMax) : 0;
  const dashOffset = CIRCUMFERENCE * (1 - fraction);

  // 0 fraction sits at the top of the circle (like the progress ring's own
  // rotate(-90) transform), increasing clockwise.
  const handleAngleRad = ((fraction * 360 - 90) * Math.PI) / 180;
  const handleX = CENTER + RADIUS * Math.cos(handleAngleRad);
  const handleY = CENTER + RADIUS * Math.sin(handleAngleRad);

  function fractionFromPoint(clientX, clientY) {
    const svg = svgRef.current;
    if (!svg) {
      return null;
    }
    const rect = svg.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    let angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    if (angle < 0) {
      angle += 360;
    }
    return angle / 360;
  }

  // 0A is a valid set-point (it lets the charger settle into SuspendedEVSE),
  // but 1-5A isn't - interactiveMin (6A) is a floor everywhere except right
  // at zero. Snap anything in that dead zone to whichever end is closer,
  // rather than just clamping up to the floor, so the very top of the ring
  // still reaches 0 instead of jumping straight to 6.
  function snapToAllowedValue(rawValue) {
    const rounded = Math.round(rawValue);
    const bounded = Math.min(safeMax, Math.max(0, rounded));
    if (bounded === 0 || bounded >= interactiveMin) {
      return bounded;
    }
    return bounded < interactiveMin / 2 ? 0 : interactiveMin;
  }

  function commitFromPoint(clientX, clientY) {
    if (safeMax <= 0) {
      return;
    }
    const pointFraction = fractionFromPoint(clientX, clientY);
    if (pointFraction === null) {
      return;
    }
    const clamped = snapToAllowedValue(pointFraction * safeMax);
    lastValueRef.current = clamped;
    onInteractiveChange?.(clamped);
  }

  function handlePointerMove(event) {
    if (!draggingRef.current) {
      return;
    }
    commitFromPoint(event.clientX, event.clientY);
  }

  function stopDragging() {
    if (!draggingRef.current) {
      return;
    }
    draggingRef.current = false;
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', stopDragging);
    if (lastValueRef.current !== null) {
      onInteractiveCommit?.(lastValueRef.current);
    }
  }

  function handlePointerDown(event) {
    if (!interactive) {
      return;
    }
    event.preventDefault();
    draggingRef.current = true;
    commitFromPoint(event.clientX, event.clientY);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopDragging);
  }

  return (
    <div className="charging-dial-wrap">
      <div className={`charging-dial${interactive ? ' is-interactive' : ''}`}>
        <svg
          ref={svgRef}
          className="charging-dial-svg"
          viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
          width={VIEWBOX_SIZE}
          height={VIEWBOX_SIZE}
          role="img"
          aria-label={interactive ? 'Max current limit, drag to adjust' : 'Charging status dial'}
          onPointerDown={handlePointerDown}
        >
          <circle className="charging-dial-track" cx={CENTER} cy={CENTER} r={RADIUS} strokeWidth={STROKE} />
          <circle
            className={`charging-dial-progress ${tone}`}
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            strokeWidth={STROKE}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${CENTER} ${CENTER})`}
          />
          {interactive ? (
            <circle className="charging-dial-handle" cx={handleX} cy={handleY} r={STROKE * 0.9} />
          ) : null}
        </svg>

        <div className="charging-dial-center">
          {badges.length > 0 ? (
            <div className="charging-dial-badges">
              {badges.map((badge) => (
                <span key={badge.key ?? badge.label} className={`charging-dial-badge ${badge.tone}`}>
                  {badge.label}
                </span>
              ))}
            </div>
          ) : null}

          <div className="charging-dial-primary">
            <span className="charging-dial-value">
              {primaryValue}
              {primaryUnit ? <span className="charging-dial-unit">{primaryUnit}</span> : null}
            </span>
          </div>

          {secondaryValue ? (
            <div className="charging-dial-secondary">
              {secondaryValue}
              {secondaryUnit ? <span className="charging-dial-secondary-unit">{secondaryUnit}</span> : null}
            </div>
          ) : null}

          {footerValue ? (
            <div className="charging-dial-footer">
              {footerLabel ? <span className="charging-dial-footer-label">{footerLabel}</span> : null}
              {footerValue}
              {footerUnit ? <span className="charging-dial-footer-unit">{footerUnit}</span> : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
