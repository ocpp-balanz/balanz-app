import React, { useRef } from 'react';

import './ChargingDial.css';

const SIZE = 220;
const STROKE = 12;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

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
 * itself: dragging anywhere on it (mouse or touch, via Pointer Events) or
 * using the arrow keys moves a handle dot around the circle and reports the
 * resulting value via onInteractiveChange, the same way a linear slider
 * would - just shaped like the dial instead of a separate control under it.
 * The caller still owns the draft/apply flow (see DialComponent's "Apply
 * limit" button); this component only ever reports a candidate value.
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
}) {
  const svgRef = useRef(null);
  const draggingRef = useRef(false);

  const safeMax = Number(max) > 0 ? Number(max) : 0;
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  const fraction = safeMax > 0 ? Math.min(1, safeValue / safeMax) : 0;
  const dashOffset = CIRCUMFERENCE * (1 - fraction);

  // 0 fraction sits at the top of the circle (like the progress ring's own
  // rotate(-90) transform), increasing clockwise.
  const handleAngleRad = ((fraction * 360 - 90) * Math.PI) / 180;
  const handleX = SIZE / 2 + RADIUS * Math.cos(handleAngleRad);
  const handleY = SIZE / 2 + RADIUS * Math.sin(handleAngleRad);

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

  function commitFromPoint(clientX, clientY) {
    if (safeMax <= 0) {
      return;
    }
    const pointFraction = fractionFromPoint(clientX, clientY);
    if (pointFraction === null) {
      return;
    }
    const raw = Math.round(pointFraction * safeMax);
    const clamped = Math.min(safeMax, Math.max(interactiveMin, raw));
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

  function handleKeyDown(event) {
    if (!interactive || safeMax <= 0) {
      return;
    }
    const step = event.shiftKey ? 5 : 1;
    const current = Math.round(safeValue);
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      event.preventDefault();
      onInteractiveChange?.(Math.min(safeMax, current + step));
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      event.preventDefault();
      onInteractiveChange?.(Math.max(interactiveMin, current - step));
    } else if (event.key === 'Home') {
      event.preventDefault();
      onInteractiveChange?.(interactiveMin);
    } else if (event.key === 'End') {
      event.preventDefault();
      onInteractiveChange?.(safeMax);
    }
  }

  return (
    <div className="charging-dial-wrap">
      <div className={`charging-dial${interactive ? ' is-interactive' : ''}`}>
        <svg
          ref={svgRef}
          className="charging-dial-svg"
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width={SIZE}
          height={SIZE}
          role={interactive ? 'slider' : 'img'}
          aria-label={interactive ? 'Max current limit' : 'Charging status dial'}
          aria-valuemin={interactive ? interactiveMin : undefined}
          aria-valuemax={interactive ? safeMax : undefined}
          aria-valuenow={interactive ? Math.round(safeValue) : undefined}
          tabIndex={interactive ? 0 : undefined}
          onPointerDown={handlePointerDown}
          onKeyDown={handleKeyDown}
        >
          <circle className="charging-dial-track" cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} strokeWidth={STROKE} />
          <circle
            className={`charging-dial-progress ${tone}`}
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            strokeWidth={STROKE}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
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
